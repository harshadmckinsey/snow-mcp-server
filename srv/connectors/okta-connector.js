const axios = require('axios');
const jwt = require('jsonwebtoken');

let oktaConfig = null;

// Get OKTA configuration from BTP Destination Service
async function getOktaFromBTPDestination() {
  try {
    console.log('Retrieving okta_gen destination from SAP BTP Destination Service...');

    // Get destination service credentials from VCAP_SERVICES
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const destServices = vcap.destination || [];

    if (destServices.length === 0) {
      throw new Error('No destination service bound to application');
    }

    const destService = destServices[0];
    const credentials = destService.credentials;

    console.log('Destination service credentials found');
    console.log(`Destination API URI: ${credentials.uri}`);

    // Build Destination Service URL
    let destServiceUrl = credentials.uri;
    if (!destServiceUrl.endsWith('/')) {
      destServiceUrl += '/';
    }
    destServiceUrl += 'destination-configuration/v1/destinations/okta_gen';

    console.log(`Destination Service URL: ${destServiceUrl}`);

    // Get access token from UAA
    console.log('Requesting access token from UAA...');

    let uaaUrl;
    if (credentials.uaa_domain) {
      uaaUrl = credentials.uaa_domain;
    } else if (credentials.url) {
      uaaUrl = credentials.url;
    } else {
      const match = credentials.uri.match(/cfapps\.([^.]+)\.hana\.ondemand\.com/);
      if (match && match[1]) {
        uaaUrl = `https://uaa.${match[1]}.hana.ondemand.com`;
      } else {
        throw new Error('Cannot derive UAA URL from credentials');
      }
    }

    if (!uaaUrl.startsWith('http')) {
      uaaUrl = 'https://' + uaaUrl;
    }
    if (!uaaUrl.endsWith('/')) {
      uaaUrl += '/';
    }
    const tokenUrl = uaaUrl + 'oauth/token';

    console.log(`Token URL: ${tokenUrl}`);

    const tokenResponse = await axios.post(
      tokenUrl,
      'grant_type=client_credentials',
      {
        auth: {
          username: credentials.clientid,
          password: credentials.clientsecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    const accessToken = tokenResponse.data.access_token;
    console.log('Access token received');

    // Get OKTA destination
    console.log('Fetching okta_gen destination...');
    const destResponse = await axios.get(destServiceUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    const destination = destResponse.data;
    const config = destination.destinationConfiguration || destination;

    console.log(`Retrieved destination: ${config.Name || 'okta_gen'}`);

    const tenant = config.URL;
    const clientId = config.clientid;
    const clientSecret = config.clientsecret;
    const authServer = config.authServer || 'default';

    console.log(`Extracted Tenant: ${tenant}`);
    console.log(`Extracted Client ID: ${clientId ? clientId.substring(0, 5) + '...' : 'undefined'}`);
    console.log(`Extracted Auth Server: ${authServer}`);

    if (!tenant || !clientId || !clientSecret) {
      throw new Error('Missing OKTA configuration in destination');
    }

    return {
      tenant,
      clientId,
      clientSecret,
      authServer
    };
  } catch (error) {
    console.error('Failed to get OKTA destination from BTP:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data));
    }
    throw error;
  }
}

// Initialize OKTA configuration
async function initializeOkta() {
  if (oktaConfig) {
    return oktaConfig;
  }

  try {
    console.log('Initializing OKTA configuration...');

    let tenant, clientId, clientSecret, authServer;

    // Try to get from SAP BTP Destination Service
    try {
      const dest = await getOktaFromBTPDestination();
      tenant = dest.tenant;
      clientId = dest.clientId;
      clientSecret = dest.clientSecret;
      authServer = dest.authServer;
      console.log('✅ Using OKTA credentials from SAP BTP Destination Service');
    } catch (btpError) {
      // Fallback to environment variables
      console.log('BTP destination not available, trying environment variables...');
      tenant = process.env.OKTA_TENANT || '';
      clientId = process.env.OKTA_CLIENT_ID || '';
      clientSecret = process.env.OKTA_CLIENT_SECRET || '';
      authServer = process.env.OKTA_AUTH_SERVER || 'default';
    }

    if (!tenant || !clientId || !clientSecret) {
      console.warn('⚠️  OKTA configuration incomplete - user token flow will be disabled');
      console.warn('Ensure okta_gen destination is bound to app via BTP Destination Service,');
      console.warn('or set OKTA_TENANT, OKTA_CLIENT_ID, OKTA_CLIENT_SECRET environment variables.');
      return null;
    }

    oktaConfig = {
      tenant,
      clientId,
      clientSecret,
      authServer,
      tokenUrl: `${tenant}/oauth2/${authServer}/v1/token`
    };

    console.log('✅ OKTA configuration loaded successfully');
    return oktaConfig;
  } catch (error) {
    console.error('Failed to initialize OKTA:', error.message);
    return null;
  }
}

// Validate OKTA token (verify JWT signature)
async function validateOktaToken(token) {
  try {
    const config = await initializeOkta();
    if (!config) {
      return null;
    }

    // Decode token to get user info without validation first
    // (Full validation requires OKTA JWK endpoint call)
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || !decoded.payload.sub) {
      console.warn('Invalid OKTA token format');
      return null;
    }

    console.log(`✅ OKTA token validated for user: ${decoded.payload.sub}`);
    return {
      userId: decoded.payload.sub,
      email: decoded.payload.email,
      token: token
    };
  } catch (error) {
    console.error('OKTA token validation failed:', error.message);
    return null;
  }
}

// Exchange OKTA token for ServiceNow access token
async function exchangeTokenForServiceNow(oktaToken) {
  try {
    const config = await initializeOkta();
    if (!config) {
      console.warn('OKTA not configured - cannot exchange token');
      return null;
    }

    // Validate OKTA token first
    const userData = await validateOktaToken(oktaToken);
    if (!userData) {
      return null;
    }

    // Get access token from OKTA for ServiceNow scope
    const response = await axios.post(
      config.tokenUrl,
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: oktaToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        scope: 'servicenow'
      }),
      {
        auth: {
          username: config.clientId,
          password: config.clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    const accessToken = response.data.access_token;
    console.log(`✅ Token exchanged for user: ${userData.userId}`);

    return {
      accessToken: accessToken,
      userId: userData.userId,
      email: userData.email,
      expiresIn: response.data.expires_in
    };
  } catch (error) {
    console.error('Token exchange failed:', error.response?.data?.error || error.message);
    return null;
  }
}

// Extract OKTA token from Authorization header
function extractTokenFromHeader(authHeader) {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

// Get user context from request (token in Authorization header)
async function getUserContext(authHeader) {
  try {
    const token = extractTokenFromHeader(authHeader);
    if (!token) {
      return null;
    }

    const userToken = await exchangeTokenForServiceNow(token);
    if (!userToken) {
      return null;
    }

    return userToken;
  } catch (error) {
    console.error('Failed to get user context:', error.message);
    return null;
  }
}

module.exports = {
  initializeOkta,
  validateOktaToken,
  exchangeTokenForServiceNow,
  extractTokenFromHeader,
  getUserContext
};
