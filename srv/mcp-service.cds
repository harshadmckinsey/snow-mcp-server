namespace sap.mcp.snow;

service MCPService {

  // MCP Endpoints - Generic ServiceNow bridge
  function listTools() returns {
    tools: array of {
      name: String;
      description: String;
    };
  };

  action callTool(name: String, arguments: String) returns {
    content: array of {
      type: String;
      text: String;
    };
    isError: Boolean;
  };

  // ServiceNow table discovery
  function getTables() returns {
    tables: array of {
      name: String;
      label: String;
      id: String;
    };
  };

  function getTableFields(tableName: String) returns {
    fields: array of {
      name: String;
      label: String;
      type: String;
      mandatory: Boolean;
    };
  };

  // Generic ServiceNow operations
  action queryTable(tableName: String, filter: String, limit: Integer) returns {
    success: Boolean;
    count: Integer;
    data: String;
  };

  action getRecord(tableName: String, recordId: String) returns {
    success: Boolean;
    data: String;
  };

  action createRecord(tableName: String, fields: String) returns {
    success: Boolean;
    id: String;
    data: String;
  };

  action updateRecord(tableName: String, recordId: String, fields: String) returns {
    success: Boolean;
    id: String;
    data: String;
  };

  action deleteRecord(tableName: String, recordId: String) returns {
    success: Boolean;
    message: String;
  };
}
