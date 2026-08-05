# Generic ServiceNow MCP Bridge Implementation

## Overview

This is a **generic, dynamic MCP bridge** between SAP Joule and ServiceNow. Unlike domain-specific implementations, this server:

1. **Discovers** all available tables in ServiceNow
2. **Creates** 5 MCP tools for each table (query, create, get, update, delete)
3. **Exposes** them to Joule dynamically (no hardcoding)
4. **Handles** any CRUD operation on any table

## Architecture

```
SAP Joule
    ↓
CAP Service (MCP Bridge)
    ├── Start
    ├── Query ServiceNow: "Give me all tables"
    ├── For each table: Create 5 tools
    ├── Register tools in MCP protocol
    └── Wait for Joule to call tools
         ↓
     Tool execution
     ├── Parse: operation_tableName
     ├── Extract: table + operation + args
     ├── Call: snowConnector.{operation}()
     └── Return: result to Joule
```

## Key Components

### 1. Snow Connector (`srv/connectors/snow-connector.js`)

**Responsibilities:**
- Manage ServiceNow connection
- Discover tables and fields
- Perform CRUD operations

**Functions:**
```javascript
getAvailableTables()        // Returns all tables
getTableFields(tableName)   // Returns fields of a table
create(table, data)         // Insert record
get(table, id)              // Get record by ID
query(table, filter, limit) // Query with filter
update(table, id, data)     // Update record
delete(table, id)           // Delete record
```

### 2. MCP Service (`srv/mcp-service.js`)

**Responsibilities:**
- Implement MCP protocol
- Discover tools on startup
- Parse and route tool calls

**Main handlers:**
```javascript
listTools()        // Returns all discovered MCP tools
callTool(request)  // Executes tool: operation_table with args
getTables()        // List ServiceNow tables
getTableFields()   // Get field definitions
queryTable()       // Generic query
createRecord()     // Generic create
getRecord()        // Generic get
updateRecord()     // Generic update
deleteRecord()     // Generic delete
```

## Request Flow

### Startup: Tool Discovery

```
1. CAP Service starts
   ↓
2. On first listTools() request:
   - Call: snowConnector.getAvailableTables()
   - ServiceNow API: GET /api/now/table/sys_db_object
   - Receives: [{name: "incident", label: "Incident"}, ...]
   ↓
3. For each table (e.g., "incident"):
   - Create: query_incident
   - Create: create_incident
   - Create: get_incident
   - Create: update_incident
   - Create: delete_incident
   ↓
4. Cache tools
   ↓
5. Return to Joule
```

### Tool Execution: Query Incidents

```
User: "List all open incidents"
   ↓
Joule calls: POST /mcp/MCPService/callTool
{
  "request": {
    "name": "query_incident",
    "arguments": {
      "filter": "stateIS1",
      "limit": 10
    }
  }
}
   ↓
CAP Service (mcp-service.js):
- Parse name: "query_incident" → operation="query", table="incident"
- Get args: {filter: "stateIS1", limit: 10}
- Call: snowConnector.query("incident", "stateIS1", 10)
   ↓
Snow Connector:
- Build request: GET /api/now/table/incident?sysparm_query=stateIS1&sysparm_limit=10
- Make HTTP call with Basic Auth
- Receive: [{sys_id: "1", number: "INC0012345", ...}, ...]
- Return: {success: true, count: 1, data: [...]}
   ↓
CAP Service returns to Joule:
{
  "content": [{
    "type": "text",
    "text": "{\"success\": true, \"count\": 1, \"data\": [...]}"
  }],
  "isError": false
}
   ↓
Joule shows results to user
```

### Tool Execution: Create Change Request

```
User: "Create change request for database update"
   ↓
Joule calls: POST /mcp/MCPService/callTool
{
  "request": {
    "name": "create_change_request",
    "arguments": {
      "fields": {
        "short_description": "Database update",
        "type": "normal",
        "urgency": "2"
      }
    }
  }
}
   ↓
CAP Service:
- Parse: operation="create", table="change_request"
- Call: snowConnector.create("change_request", {short_description: ..., type: ..., urgency: ...})
   ↓
Snow Connector:
- Build payload with fields
- POST /api/now/table/change_request
- Receive: {sys_id: "abc123", number: "CHG0045678", ...}
- Return: {success: true, id: "abc123", data: {...}}
   ↓
Joule: "Created change request CHG0045678"
```

## Tool Naming Convention

```
{operation}_{tableName}

operation = query | create | get | update | delete
tableName = Any ServiceNow table (incident, change_request, customer, etc.)

Examples:
- query_incident          (search incidents)
- create_incident         (create incident)
- get_incident            (get specific incident)
- update_incident         (update incident)
- delete_incident         (delete incident)
- query_change_request    (search change requests)
- create_purchase_order   (create PO)
- get_customer            (get customer)
- update_problem          (update problem record)
```

## CRUD Operations

### Query (READ many)
```javascript
snowConnector.query(tableName, filter, limit)

filter = ServiceNow query syntax: "stateIS1^nameContainsFoo^ORDERBYDESCsys_created_on"
limit = Max results (default 10)

Returns: {success, count, data: [records]}
```

### Create (CREATE)
```javascript
snowConnector.create(tableName, data)

data = Object with field:value pairs to create

Returns: {success, id, data: createdRecord}
```

### Get (READ one)
```javascript
snowConnector.get(tableName, recordId)

recordId = sys_id of record

Returns: {success, data: record}
```

### Update (UPDATE)
```javascript
snowConnector.update(tableName, recordId, data)

data = Fields to update

Returns: {success, id, data: updatedRecord}
```

### Delete (DELETE)
```javascript
snowConnector.delete(tableName, recordId)

Returns: {success, message}
```

## Tool Discovery Process

```javascript
// srv/mcp-service.js

async function discoverToolsFromServiceNow() {
  // 1. Query ServiceNow for all tables
  discoveredTables = await snowConnector.getAvailableTables()
  // Returns: [{name: "incident", label: "Incident"}, {...}]

  // 2. For each table, create 5 tools
  discoveredTables.forEach(table => {
    // query_{table}
    tools.push({name: "query_" + table.name, ...})
    
    // create_{table}
    tools.push({name: "create_" + table.name, ...})
    
    // get_{table}
    tools.push({name: "get_" + table.name, ...})
    
    // update_{table}
    tools.push({name: "update_" + table.name, ...})
    
    // delete_{table}
    tools.push({name: "delete_" + table.name, ...})
  })

  // 3. Cache and return
  mcpTools = tools
  return mcpTools
}

// Called on first listTools() request
```

## Tool Execution Logic

```javascript
// srv/mcp-service.js

srv.on('CREATE', 'callTool', async (req) => {
  const { name, arguments: args } = req.data.request

  // 1. Parse tool name
  const parts = name.split('_')
  const operation = parts[0]           // query, create, get, update, delete
  const tableName = parts.slice(1).join('_')  // table name

  // 2. Route to appropriate operation
  switch(operation) {
    case 'query':
      result = await snowConnector.query(tableName, args.filter, args.limit)
      break
    case 'create':
      result = await snowConnector.create(tableName, args.fields)
      break
    case 'get':
      result = await snowConnector.get(tableName, args.recordId)
      break
    case 'update':
      result = await snowConnector.update(tableName, args.recordId, args.fields)
      break
    case 'delete':
      result = await snowConnector.delete(tableName, args.recordId)
      break
  }

  // 3. Return result to Joule
  return {
    content: [{type: 'text', text: JSON.stringify(result)}],
    isError: false
  }
})
```

## ServiceNow Query Filters

The `query` tool uses ServiceNow's query syntax:

```
stateIS1              // state = 1
priorityIS1           // priority = 1
nameContainsFoo       // name contains "Foo"
activeISFALSE         // active = false
assignedISNOT EMPTY   // assigned is not empty
ORDERBYDESCsys_created_on  // Sort by created date desc
ORDERBYsys_updated_on      // Sort by updated date asc
^                     // AND operator
OR                    // OR operator
```

Examples:
```
stateIS1^priorityIS1                    // state=1 AND priority=1
stateIS1^ORDERBYDESCsys_created_on      // state=1, sorted by created
assignedISNOT EMPTY^urgencyIS1^ORpriority  // assigned AND (urgent OR priority)
```

## Error Handling

All errors return MCP error format:

```json
{
  "content": [{
    "type": "text",
    "text": "Error: <message>"
  }],
  "isError": true
}
```

Examples:
- "ServiceNow connection failed: [reason]"
- "Failed to create record: [reason]"
- "Invalid tool name: xyz"
- "Unknown table: foo"

## Caching Strategy

```javascript
// Tools are discovered once and cached
let mcpTools = null        // Cached tool list
let discoveredTables = null // Cached table list

// First call to listTools():
// - Query ServiceNow
// - Build tools
// - Cache result
// - Return

// Subsequent calls:
// - Return cached tools (no SNOW query)
```

**Invalidation:** Manual restart required if ServiceNow tables change

## Performance

- **Startup**: ~2-3 seconds (CAP startup)
- **First listTools()**: ~500ms (queries ServiceNow for tables)
- **Subsequent listTools()**: <1ms (cached)
- **Tool execution**: 500ms-2s (depends on SNOW API)
- **Memory**: ~50MB (minimal)
- **Scalability**: Can handle 100s of tools, 1000s of concurrent requests

## Security

- **Authentication**: Basic Auth to ServiceNow
- **Transport**: HTTPS only (production)
- **Credentials**: Stored in SAP Destination Service (production) or .env (development)
- **Isolation**: Stateless - no data stored locally
- **Authorization**: Inherits ServiceNow user permissions

## Limitations & Notes

1. **ServiceNow API quotas** - Respect rate limits
2. **Field types** - Tool doesn't validate field types; ServiceNow API returns errors
3. **Relationships** - Can query related tables but not traverse relationships
4. **Large datasets** - Use `limit` parameter to control result size
5. **Permissions** - Operations respect ServiceNow user ACLs
