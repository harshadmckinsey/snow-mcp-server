const express = require('express');
const standardMcpConnector = require('./connectors/standard-mcp-connector');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

let mcpTools = null;

// Get cached tools from standard MCP server
async function getTools() {
  if (mcpTools) {
    return mcpTools;
  }

  try {
    console.log('📡 Fetching tools from standard MCP server...');
    mcpTools = await standardMcpConnector.getTools();
    console.log(`✅ Retrieved ${mcpTools.length} tools from standard MCP server`);
    return mcpTools;
  } catch (error) {
    console.error('Failed to fetch tools from standard MCP server:', error.message);
    return [];
  }
}

// MCP Endpoint - handles initialize, tools/list, tools/call, notifications
app.post('/mcp', async (req, res) => {
  const { method, id, params } = req.body || {};
  const requestId = id || 0;

  console.log('📥 POST /mcp', { method, id, hasBody: !!req.body });

  try {
    if (!method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: requestId,
        error: { code: -32700, message: 'Parse error: missing method' }
      });
    }

    if (method === 'initialize') {
      console.log('🔧 Initialize');
      return res.json({
        jsonrpc: '2.0',
        id: requestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'ServiceNow MCP Server', version: '1.0.0' }
        }
      });
    }

    // Handle MCP notifications (no response needed, but server must accept them)
    if (method && method.startsWith('notifications/')) {
      console.log(`📢 Notification: ${method}`);
      return res.status(200).end();
    }

    if (method === 'tools/list') {
      console.log('📋 Tools list');
      const tools = await getTools();
      return res.json({
        jsonrpc: '2.0',
        id: requestId,
        result: { tools }
      });
    }

    if (method === 'tools/call') {
      console.log(`🔨 Call: ${params?.name}`);
      const { name, arguments: args } = params;

      let parsedArgs = args;
      if (typeof args === 'string') {
        parsedArgs = JSON.parse(args);
      }

      // Strip namespace prefix (e.g., "snowdevtest.snowdev0-get_sc_req_item" → "get_sc_req_item")
      let toolName = name;
      if (name.includes('-')) {
        const lastDashIndex = name.lastIndexOf('-');
        toolName = name.substring(lastDashIndex + 1);
      }

      // Proxy tool call to standard MCP server
      const result = await standardMcpConnector.callTool(toolName, parsedArgs);

      return res.json({
        jsonrpc: '2.0',
        id: requestId,
        result: result
      });
    }

    res.status(400).json({
      jsonrpc: '2.0',
      id: requestId,
      error: { code: -32601, message: `Unknown method: ${method}` }
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      jsonrpc: '2.0',
      id: requestId,
      error: { code: -32603, message: error.message }
    });
  }
});

// GET /mcp - Simple tool listing
app.get('/mcp', async (req, res) => {
  const tools = await getTools();
  res.json({ tools });
});

// Start server
const PORT = process.env.PORT || 4004;
app.listen(PORT, async () => {
  console.log(`🚀 ServiceNow MCP Proxy Server on port ${PORT}`);
  console.log('📍 POST /mcp - MCP JSON-RPC (initialize, tools/list, tools/call)');
  console.log('📍 GET  /mcp - List tools');
  console.log('🔌 Proxying to: https://mckinseydev.service-now.com/sncapps/mcp-server/mcp/servicenow_itsm_mcp_server');

  console.log('Pre-discovering tools from standard MCP server...');
  try {
    await getTools();
    console.log('✅ Ready');
  } catch (error) {
    console.error('⚠️ Error:', error.message);
  }
});
