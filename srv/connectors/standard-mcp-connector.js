const axios = require('axios');
const oktaConnector = require('./okta-connector');

const STANDARD_MCP_URL = 'https://mckinseydev.service-now.com/sncapps/mcp-server/mcp/servicenow_itsm_mcp_server';
const SERVICENOW_CLIENT_ID = '65a7f537e4ad4c419eb1ef297db0f351';

let cachedTools = null;
let cachedOktaToken = null;
let tokenExpiry = null;

async function getOktaToken() {
  try {
    const currentTime = Date.now();

    // Return cached token if still valid (with 5 min buffer)
    if (cachedOktaToken && tokenExpiry && currentTime < (tokenExpiry - 5 * 60 * 1000)) {
      console.log('✅ Using cached OKTA token');
      return cachedOktaToken;
    }

    console.log('📡 Requesting new OKTA token...');

    // Initialize OKTA configuration
    const oktaConfig = await oktaConnector.initializeOkta();
    if (!oktaConfig) {
      throw new Error('OKTA configuration not available');
    }

    // Get token for ServiceNow scope
    const response = await axios.post(
      oktaConfig.tokenUrl,
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'servicenow',
        client_id: oktaConfig.clientId
      }),
      {
        auth: {
          username: oktaConfig.clientId,
          password: oktaConfig.clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    const token = response.data.access_token;
    const expiresIn = response.data.expires_in || 3600; // Default 1 hour

    cachedOktaToken = token;
    tokenExpiry = currentTime + (expiresIn * 1000);

    console.log(`✅ New OKTA token obtained (expires in ${expiresIn}s)`);
    return token;
  } catch (error) {
    console.error('Failed to get OKTA token:', error.message);
    throw new Error(`OKTA token retrieval failed: ${error.message}`);
  }
}

async function callStandardMCP(method, params) {
  try {
    const token = await getOktaToken();

    const payload = {
      jsonrpc: '2.0',
      method: method,
      id: Math.floor(Math.random() * 10000)
    };

    if (params) {
      payload.params = params;
    }

    console.log(`📤 Calling standard MCP: ${method}`);

    const response = await axios.post(STANDARD_MCP_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      timeout: 30000
    });

    if (response.data.error) {
      throw new Error(`MCP Error: ${response.data.error.message}`);
    }

    console.log(`✅ Standard MCP call successful: ${method}`);
    return response.data.result;
  } catch (error) {
    console.error(`Standard MCP call failed (${method}):`, error.message);
    throw error;
  }
}

async function getTools() {
  try {
    if (cachedTools) {
      console.log(`✅ Using cached tools (${cachedTools.length} tools)`);
      return cachedTools;
    }

    console.log('🔍 Discovering tools from standard MCP server...');
    const result = await callStandardMCP('tools/list');

    if (!result.tools || !Array.isArray(result.tools)) {
      throw new Error('Invalid tools response from standard MCP server');
    }

    cachedTools = result.tools;
    console.log(`✅ Discovered ${cachedTools.length} tools from standard MCP server`);
    return cachedTools;
  } catch (error) {
    console.error('Failed to get tools:', error.message);
    throw error;
  }
}

async function callTool(toolName, arguments_) {
  try {
    console.log(`🔨 Calling tool via standard MCP: ${toolName}`);

    const result = await callStandardMCP('tools/call', {
      name: toolName,
      arguments: arguments_
    });

    console.log(`✅ Tool call successful: ${toolName}`);
    return result;
  } catch (error) {
    console.error(`Tool call failed (${toolName}):`, error.message);
    throw error;
  }
}

module.exports = {
  getTools,
  callTool,
  getOktaToken
};
