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
        description: `[MCP] Search ${table.label} records using ServiceNow query syntax. Apply filters to find multiple matching records (e.g., numberISRITM1234567). Returns list of results via MCP protocol.`,
        inputSchema: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'ServiceNow query filter (e.g., numberISRITM1234567 or stateINin_progress,closed)' },
            limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' }
          },
          required: ['filter']
        }
      });

      mcpTools.push({
        name: `create_${table.name}`,
        description: `[MCP] Create a new ${table.label} record with specified fields via MCP protocol. Returns the created record with sys_id.`,
        inputSchema: {
          type: 'object',
          properties: { fields: { type: 'object', description: 'Record field values (e.g., {short_description: "...", description: "..."})' } },
          required: ['fields']
        }
      });

      mcpTools.push({
        name: `get_${table.name}`,
        description: `[MCP] Retrieve a single ${table.label} record by sys_id via MCP protocol. Use this to fetch complete details of a specific record.`,
        inputSchema: {
          type: 'object',
          properties: { recordId: { type: 'string', description: 'Unique system ID (sys_id) of the record to retrieve' } },
          required: ['recordId']
        }
      });

      mcpTools.push({
        name: `update_${table.name}`,
        description: `[MCP] Update specific fields of a ${table.label} record by sys_id via MCP protocol. Returns the updated record.`,
        inputSchema: {
          type: 'object',
          properties: {
            recordId: { type: 'string', description: 'Unique system ID (sys_id) of the record to update' },
            fields: { type: 'object', description: 'Field values to update (e.g., {state: "in_progress"})' }
          },
          required: ['recordId', 'fields']
        }
      });

      mcpTools.push({
        name: `delete_${table.name}`,
        description: `[MCP] Delete a ${table.label} record by sys_id via MCP protocol. Warning: This operation cannot be undone.`,
        inputSchema: {
          type: 'object',
          properties: { recordId: { type: 'string', description: 'Unique system ID (sys_id) of the record to delete' } },
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

      // Strip namespace prefix (e.g., "snowdevtest.snowdev0-get_sc_req_item" → "get_sc_req_item")
      let toolName = name;
      if (name.includes('-')) {
        const lastDashIndex = name.lastIndexOf('-');
        toolName = name.substring(lastDashIndex + 1);
      }

      const parts = toolName.split('_');
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
