const axios = require('axios');

let snowClient = null;

async function getDestinationFromBTP() {
  try {
    console.log('Retrieving snow_gen destination from SAP BTP Destination Service...');

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

    // Build Destination Service URL - ensure proper format
    let destServiceUrl = credentials.uri;
    if (!destServiceUrl.endsWith('/')) {
      destServiceUrl += '/';
    }
    destServiceUrl += 'destination-configuration/v1/destinations/snow_gen';

    console.log(`Destination Service URL: ${destServiceUrl}`);

    // Get access token from UAA
    console.log('Requesting access token from UAA...');

    // Derive UAA URL from credentials
    let uaaUrl;
    if (credentials.uaa_domain) {
      uaaUrl = credentials.uaa_domain;
    } else if (credentials.url) {
      uaaUrl = credentials.url;
    } else {
      // Derive from destination URI: extract domain from https://destination-configuration.cfapps.{region}.hana.ondemand.com
      // Build UAA URL: https://uaa.{region}.hana.ondemand.com
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

    // Get destination
    console.log('Fetching snow_gen destination...');
    const destResponse = await axios.get(destServiceUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    const destination = destResponse.data;
    const config = destination.destinationConfiguration || destination;

    console.log(`Retrieved destination: ${config.Name || 'snow_gen'}`);

    const url = config.URL;
    const user = config.User;
    const password = config.Password;

    console.log(`Extracted URL: ${url}`);
    console.log(`Extracted User: ${user}`);
    console.log(`Extracted Password: ${password ? '***' : 'undefined'}`);

    if (!url || !user || !password) {
      throw new Error('Missing credentials in destination configuration');
    }

    return {
      url,
      username: config.Authentication === 'BasicAuthentication' ? user : null,
      password: config.Authentication === 'BasicAuthentication' ? password : null
    };
  } catch (error) {
    console.error('Failed to get destination from BTP:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data));
    }
    throw error;
  }
}

async function initializeSnowClient() {
  if (snowClient) {
    return snowClient;
  }

  try {
    console.log('Initializing ServiceNow client...');

    let baseURL, username, password;

    // Try to get from SAP BTP Destination Service
    try {
      const dest = await getDestinationFromBTP();
      baseURL = dest.url;
      username = dest.username;
      password = dest.password;
      console.log('Using credentials from SAP BTP Destination Service');
    } catch (btpError) {
      // Fallback to environment variables
      console.log('BTP destination not available, trying environment variables...');
      baseURL = process.env.SNOW_URL;
      username = process.env.SNOW_USER;
      password = process.env.SNOW_PASSWORD;
    }

    if (!baseURL || !username || !password) {
      throw new Error(
        'Could not retrieve ServiceNow credentials. ' +
        'Ensure snow_gen destination is bound to app via destination service, ' +
        'or set SNOW_URL, SNOW_USER, SNOW_PASSWORD environment variables.'
      );
    }

    const config = {
      baseURL: `${baseURL}/api/now`,
      auth: {
        username,
        password
      }
    };

    snowClient = axios.create({
      ...config,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    console.log('ServiceNow client initialized successfully');
    return snowClient;
  } catch (error) {
    console.error('Failed to initialize ServiceNow client:', error.message);
    throw new Error(`ServiceNow connection failed: ${error.message}`);
  }
}

// Get available tables from ServiceNow
async function getAvailableTables() {
  // Only expose RITM (Service Catalog Request Items) tools
  return [
    {
      name: 'sc_req_item',
      label: 'Service Catalog Request Item',
      id: 'sc_req_item'
    }
  ];
}

// Get fields for a specific table
async function getTableFields(tableName) {
  const client = await initializeSnowClient();

  try {
    // Query sys_dictionary for fields of the table
    const response = await client.get('/table/sys_dictionary', {
      params: {
        sysparm_query: `name=${tableName}`,
        sysparm_fields: 'column_label,name,type,mandatory',
        sysparm_limit: 100
      }
    });

    return response.data.result.map(field => ({
      label: field.column_label,
      name: field.name,
      type: field.type,
      mandatory: field.mandatory
    }));
  } catch (error) {
    throw new Error(`Failed to get fields for ${tableName}: ${error.message}`);
  }
}

// Generic CREATE operation
async function create(tableName, data) {
  const client = await initializeSnowClient();

  try {
    const response = await client.post(`/table/${tableName}`, data);

    return {
      success: true,
      id: response.data.result.sys_id,
      number: response.data.result.number || response.data.result.sys_id,
      data: response.data.result
    };
  } catch (error) {
    throw new Error(`Failed to create record in ${tableName}: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Generic READ/GET operation
async function get(tableName, recordId) {
  const client = await initializeSnowClient();

  try {
    const response = await client.get(`/table/${tableName}/${recordId}`);

    if (!response.data.result) {
      throw new Error('Record not found');
    }

    return {
      success: true,
      data: response.data.result
    };
  } catch (error) {
    throw new Error(`Failed to get record from ${tableName}: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Generic QUERY operation
async function query(tableName, filter, limit = 10) {
  const client = await initializeSnowClient();

  try {
    const response = await client.get(`/table/${tableName}`, {
      params: {
        sysparm_query: filter,
        sysparm_limit: limit
      }
    });

    return {
      success: true,
      count: response.data.result.length,
      data: response.data.result
    };
  } catch (error) {
    throw new Error(`Failed to query ${tableName}: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Generic UPDATE operation
async function update(tableName, recordId, data) {
  const client = await initializeSnowClient();

  try {
    const response = await client.patch(`/table/${tableName}/${recordId}`, data);

    return {
      success: true,
      id: response.data.result.sys_id,
      data: response.data.result
    };
  } catch (error) {
    throw new Error(`Failed to update record in ${tableName}: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Generic DELETE operation
async function delete_(tableName, recordId) {
  const client = await initializeSnowClient();

  try {
    await client.delete(`/table/${tableName}/${recordId}`);

    return {
      success: true,
      message: `Record deleted from ${tableName}`
    };
  } catch (error) {
    throw new Error(`Failed to delete record from ${tableName}: ${error.response?.data?.error?.message || error.message}`);
  }
}

module.exports = {
  initializeSnowClient,
  getAvailableTables,
  getTableFields,
  create,
  get,
  query,
  update,
  delete: delete_
};
