const cds = require('@sap/cds');
const snowConnector = require('./connectors/snow-connector');

// Cache for discovered tables and tools
let discoveredTables = null;
let mcpTools = null;

module.exports = cds.service.impl(async (srv) => {

  // Discover ServiceNow tables and build MCP tools
  async function discoverToolsFromServiceNow() {
    if (mcpTools) {
      return mcpTools;
    }

    try {
      console.log('Discovering ServiceNow tables...');
      discoveredTables = await snowConnector.getAvailableTables();
      console.log(`Found ${discoveredTables.length} tables`);

      // Build MCP tools for common operations on each table
      mcpTools = [];

      // Add generic tools for each table
      discoveredTables.forEach(table => {
        mcpTools.push({
          name: `query_${table.name}`,
          description: `Query records from ${table.label} table`,
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                description: 'ServiceNow query filter (e.g., "stateIS1")'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 10)'
              }
            },
            required: ['filter']
          }
        });

        mcpTools.push({
          name: `create_${table.name}`,
          description: `Create a new record in ${table.label}`,
          inputSchema: {
            type: 'object',
            properties: {
              fields: {
                type: 'object',
                description: 'Record fields to create'
              }
            },
            required: ['fields']
          }
        });

        mcpTools.push({
          name: `get_${table.name}`,
          description: `Get a specific record from ${table.label}`,
          inputSchema: {
            type: 'object',
            properties: {
              recordId: {
                type: 'string',
                description: 'Record ID (sys_id)'
              }
            },
            required: ['recordId']
          }
        });

        mcpTools.push({
          name: `update_${table.name}`,
          description: `Update a record in ${table.label}`,
          inputSchema: {
            type: 'object',
            properties: {
              recordId: {
                type: 'string',
                description: 'Record ID (sys_id)'
              },
              fields: {
                type: 'object',
                description: 'Fields to update'
              }
            },
            required: ['recordId', 'fields']
          }
        });

        mcpTools.push({
          name: `delete_${table.name}`,
          description: `Delete a record from ${table.label}`,
          inputSchema: {
            type: 'object',
            properties: {
              recordId: {
                type: 'string',
                description: 'Record ID (sys_id)'
              }
            },
            required: ['recordId']
          }
        });
      });

      console.log(`Created ${mcpTools.length} MCP tools`);
      return mcpTools;
    } catch (error) {
      console.error('Failed to discover tools:', error.message);
      // Return empty tools if discovery fails
      return [];
    }
  }

  // MCP: List available tools
  srv.on('READ', 'listTools', async (req) => {
    try {
      const tools = await discoverToolsFromServiceNow();
      console.log(`MCP: Returning ${tools.length} tools`);
      return { tools };
    } catch (error) {
      console.error('Error listing tools:', error.message);
      return { tools: [] };
    }
  });

  // MCP: Execute a tool
  srv.on('CREATE', 'callTool', async (req) => {
    const { name, arguments: args } = req.data;

    console.log(`MCP: Executing tool '${name}'`);

    try {
      let result;

      // Parse arguments if it's a string
      let parsedArgs = args;
      if (typeof args === 'string') {
        try {
          parsedArgs = JSON.parse(args);
        } catch (e) {
          parsedArgs = {};
        }
      }

      // Parse tool name: operation_tableName
      const parts = name.split('_');
      const operation = parts[0]; // query, create, get, update, delete
      const tableName = parts.slice(1).join('_'); // rest is table name

      if (!tableName) {
        throw new Error(`Invalid tool name: ${name}`);
      }

      switch (operation) {
        case 'query':
          result = await snowConnector.query(
            tableName,
            parsedArgs.filter || '',
            parsedArgs.limit || 10
          );
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

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }],
        isError: false
      };
    } catch (error) {
      console.error(`Tool execution error [${name}]:`, error.message);
      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  });

  // Get available tables
  srv.on('READ', 'getTables', async (req) => {
    try {
      if (!discoveredTables) {
        discoveredTables = await snowConnector.getAvailableTables();
      }
      return {
        tables: discoveredTables
      };
    } catch (error) {
      req.error(500, `Failed to get tables: ${error.message}`);
    }
  });

  // Get fields for a table
  srv.on('READ', 'getTableFields', async (req) => {
    const { tableName } = req.data;

    try {
      const fields = await snowConnector.getTableFields(tableName);
      return {
        fields
      };
    } catch (error) {
      req.error(500, `Failed to get fields: ${error.message}`);
    }
  });

  // Query table
  srv.on('CREATE', 'queryTable', async (req) => {
    const { tableName, filter, limit } = req.data;

    try {
      return await snowConnector.query(tableName, filter, limit || 10);
    } catch (error) {
      req.error(500, error.message);
    }
  });

  // Get record
  srv.on('READ', 'getRecord', async (req) => {
    const { tableName, recordId } = req.data;

    try {
      return await snowConnector.get(tableName, recordId);
    } catch (error) {
      req.error(500, error.message);
    }
  });

  // Create record
  srv.on('CREATE', 'createRecord', async (req) => {
    const { tableName, fields } = req.data;

    try {
      return await snowConnector.create(tableName, fields);
    } catch (error) {
      req.error(500, error.message);
    }
  });

  // Update record
  srv.on('CREATE', 'updateRecord', async (req) => {
    const { tableName, recordId, fields } = req.data;

    try {
      return await snowConnector.update(tableName, recordId, fields);
    } catch (error) {
      req.error(500, error.message);
    }
  });

  // Delete record
  srv.on('CREATE', 'deleteRecord', async (req) => {
    const { tableName, recordId } = req.data;

    try {
      return await snowConnector.delete(tableName, recordId);
    } catch (error) {
      req.error(500, error.message);
    }
  });

  // Initialize: Discover tools on startup
  console.log('MCPService initialized. Discovering ServiceNow tools on first request...');
});
