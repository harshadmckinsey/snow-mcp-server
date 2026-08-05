const express = require('express');
const snowConnector = require('./connectors/snow-connector');

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

// Get cached tools or discover
async function getTools() {
  if (mcpTools) {
    return mcpTools;
  }

  try {
    console.log('Discovering ServiceNow tables...');
    const tables = await snowConnector.getAvailableTables();
    mcpTools = [];

    tables.forEach(table => {
      mcpTools.push({
        name: `query_${table.name}`,
        description: `Query records from ${table.label}`,
        inputSchema: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'ServiceNow query filter' },
            limit: { type: 'number', description: 'Max results (default: 10)' }
          },
          required: ['filter']
        }
      });

      mcpTools.push({
        name: `create_${table.name}`,
        description: `Create a record in ${table.label}`,
        inputSchema: {
          type: 'object',
          properties: { fields: { type: 'object', description: 'Record fields' } },
          required: ['fields']
        }
      });

      mcpTools.push({
        name: `get_${table.name}`,
        description: `Get a record from ${table.label}`,
        inputSchema: {
          type: 'object',
          properties: { recordId: { type: 'string', description: 'Record ID' } },
          required: ['recordId']
        }
      });

      mcpTools.push({
        name: `update_${table.name}`,
        description: `Update a record in ${table.label}`,
        inputSchema: {
          type: 'object',
          properties: {
            recordId: { type: 'string', description: 'Record ID' },
            fields: { type: 'object', description: 'Fields to update' }
          },
          required: ['recordId', 'fields']
        }
      });

      mcpTools.push({
        name: `delete_${table.name}`,
        description: `Delete a record from ${table.label}`,
        inputSchema: {
          type: 'object',
          properties: { recordId: { type: 'string', description: 'Record ID' } },
          required: ['recordId']
        }
      });
    });

    console.log(`Created ${mcpTools.length} MCP tools`);
    return mcpTools;
  } catch (error) {
    console.error('Failed to discover tools:', error.message);
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

      const parts = name.split('_');
      const operation = parts[0];
      const tableName = parts.slice(1).join('_');

      let result;
      switch (operation) {
        case 'query':
          result = await snowConnector.query(tableName, parsedArgs.filter || '', parsedArgs.limit || 10);
          break;
        case 'create':
          result = await snowConnector.create(tableName, parsedArgs.fields || {});
          break;
        case 'get':
          result = await snowConnector.get(tableName, parsedArgs.recordId);
          break;
        case 'update':
          result = await snowConnector.update(tableName, parsedArgs.recordId, parsedArgs.fields || {});
          break;
        case 'delete':
          result = await snowConnector.delete(tableName, parsedArgs.recordId);
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      return res.json({
        jsonrpc: '2.0',
        id: requestId,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false
        }
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
  console.log(`🚀 ServiceNow MCP Server on port ${PORT}`);
  console.log('📍 POST /mcp - MCP JSON-RPC (initialize, tools/list, tools/call)');
  console.log('📍 GET  /mcp - List tools');

  console.log('Pre-discovering tools...');
  try {
    await getTools();
    console.log('✅ Ready');
  } catch (error) {
    console.error('⚠️ Error:', error.message);
  }
});
