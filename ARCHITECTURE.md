# Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│ SAP Joule (AI Assistant)                                    │
│ - Conversational Interface                                   │
│ - Natural Language Processing                                │
└────────────┬────────────────────────────────────────────────┘
             │
             │ MCP Protocol (JSON-RPC 2.0 over HTTPS)
             │ - initialize, tools/list, tools/call
             │ - notifications handling
             │
┌────────────▼────────────────────────────────────────────────┐
│ Express.js MCP Server (Port 8080)                           │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ srv/index.js                                             ││
│ │ - POST /mcp: JSON-RPC handler                            ││
│ │ - GET /mcp: Tool listing endpoint                        ││
│ │ - CORS middleware                                        ││
│ │ - Tool pre-discovery on startup                          ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────────────────────┐│
│ │ srv/connectors/snow-connector.js                         ││
│ │ - BTP Destination Service credential retrieval           ││
│ │ - OAuth2 token exchange with UAA                         ││
│ │ - ServiceNow REST API integration                        ││
│ │ - Generic CRUD operations (create, get, query, etc)     ││
│ └──────────────────────────────────────────────────────────┘│
└────────────┬────────────────────────────────────────────────┘
             │
             ├─→ BTP Destination Service (OAuth2)
             │   └─→ SAP UAA (Token exchange)
             │
             │ REST API (HTTPS)
             │ Basic Authentication
             │
┌────────────▼────────────────────────────────────────────────┐
│ ServiceNow API                                              │
│ - Service Catalog Request Items (sc_req_item)               │
│   - Query, Create, Get, Update, Delete operations          │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
snow-mcp-server/
├── srv/
│   ├── index.js                      # Express.js MCP server (POST/GET /mcp)
│   ├── connectors/
│   │   └── snow-connector.js         # ServiceNow REST client
│   │       ├── getDestinationFromBTP() - Retrieves credentials from SAP BTP
│   │       ├── initializeSnowClient() - Creates Axios instance
│   │       ├── getAvailableTables()  - Returns sc_req_item table
│   │       ├── query()               - Query records with filter
│   │       ├── get()                 - Get record by ID
│   │       ├── create()              - Create new record
│   │       ├── update()              - Update existing record
│   │       └── delete()              - Delete record
│   └── config/
│       └── environment.js             # Environment configuration
├── test/
│   └── snow-connector.test.js         # Unit tests
├── .env.example                       # Environment template
├── .gitignore                         # Git ignore rules
├── .cfignore                          # Cloud Foundry ignore rules
├── package.json                       # Node dependencies (express, axios)
├── .cdsrc.json                        # CAP config (auth.kind: "none")
├── manifest.yml                       # Cloud Foundry deployment manifest
├── mta.yaml                          # SAP BTP MTA deployment (alternative)
├── README.md                         # Documentation
├── DEPLOYMENT.md                     # Deployment guide
├── QUICKSTART.md                     # Quick start guide
├── CLAUDE.md                         # Claude Code documentation
└── ARCHITECTURE.md                   # This file
```

## Data Flow

### MCP Protocol Initialization

```
1. Joule Connection
   ↓
   POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp
   {
     "method": "initialize",
     "id": 1
   }

2. MCP Server Response
   ↓
   {
     "jsonrpc": "2.0",
     "id": 1,
     "result": {
       "protocolVersion": "2024-11-05",
       "capabilities": { "tools": {} },
       "serverInfo": { "name": "ServiceNow MCP Server", "version": "1.0.0" }
     }
   }

3. Joule Notification
   ↓
   POST /mcp
   {
     "method": "notifications/initialized",
     "params": { ... }
   }

4. Server Response
   ↓
   HTTP 200 (no body)
```

### Tool Discovery

```
1. Joule Request
   ↓
   POST /mcp
   {
     "method": "tools/list",
     "id": 2
   }

2. Server Pre-discovers Tools (cached)
   ↓
   - Calls getAvailableTables() → Returns [sc_req_item]
   - Generates 5 tools per table:
     * query_sc_req_item
     * create_sc_req_item
     * get_sc_req_item
     * update_sc_req_item
     * delete_sc_req_item

3. Response (1.3KB response)
   ↓
   {
     "jsonrpc": "2.0",
     "id": 2,
     "result": {
       "tools": [
         { "name": "query_sc_req_item", "description": "...", "inputSchema": {...} },
         { "name": "create_sc_req_item", "description": "...", "inputSchema": {...} },
         ...
       ]
     }
   }
```

### Querying Request Items

```
1. User Input (Joule)
   ↓
   "Show me RITM11172625"

2. Joule Processing
   ↓
   Parses intent → Calls MCP tool "query_sc_req_item"

3. MCP Request
   ↓
   POST /mcp
   {
     "method": "tools/call",
     "id": 3,
     "params": {
       "name": "query_sc_req_item",
       "arguments": {
         "filter": "numberISRITM11172625",
         "limit": 1
       }
     }
   }

4. MCP Server Processing
   ↓
   snowConnector.query("sc_req_item", "numberISRITM11172625", 1)

5. Credential Retrieval (if not cached)
   ↓
   - Read VCAP_SERVICES from environment
   - Extract destination service credentials
   - Build UAA URL (https://uaa.eu10.hana.ondemand.com)
   - Exchange client credentials for access token (OAuth2)
   - Call Destination Service API to get snow_gen destination
   - Extract: URL, username, password from destinationConfiguration
   - Create Axios instance with Basic Auth

6. ServiceNow API Call
   ↓
   GET /api/now/table/sc_req_item
   ?sysparm_query=numberISRITM11172625
   ?sysparm_limit=1
   Authorization: Basic base64(username:password)

7. ServiceNow Response
   ↓
   {
     "result": [
       {
         "sys_id": "abc123",
         "number": "RITM11172625",
         "short_description": "Request for laptop",
         "state": "approved",
         "assigned_to": "john.doe@example.com",
         ...
       }
     ]
   }

8. MCP Response
   ↓
   {
     "jsonrpc": "2.0",
     "id": 3,
     "result": {
       "content": [{
         "type": "text",
         "text": "{\n  \"success\": true,\n  \"data\": [...]\n}"
       }],
       "isError": false
     }
   }

9. Joule Output
   ↓
   "RITM11172625: Request for laptop (Status: Approved)"
```

### Creating a Request Item

```
1. MCP Request
   ↓
   POST /mcp
   {
     "method": "tools/call",
     "id": 4,
     "params": {
       "name": "create_sc_req_item",
       "arguments": {
         "fields": {
           "short_description": "New laptop request",
           "description": "Employee needs new laptop for development"
         }
       }
     }
   }

2. MCP Server
   ↓
   snowConnector.create("sc_req_item", {...fields})

3. ServiceNow API Call
   ↓
   POST /api/now/table/sc_req_item
   Content-Type: application/json
   {
     "short_description": "New laptop request",
     "description": "Employee needs new laptop for development"
   }

4. ServiceNow Response
   ↓
   { "result": { "sys_id": "xyz789", "number": "RITM00001234", ... } }

5. MCP Response
   ↓
   { "success": true, "id": "xyz789", "number": "RITM00001234" }
```

## Tool Definitions

All tools are **generic CRUD operations** on the `sc_req_item` (Service Catalog Request Item) table.

### Tool: query_sc_req_item

```
Description: Query/search request items with filters
ServiceNow Table: sc_req_item

Input Schema:
{
  filter: string (required) - ServiceNow query filter (e.g., "numberISRITM11172625")
  limit: number (optional, default: 10) - Max results to return
}

Output:
{
  success: boolean
  data: array of records
}

Examples:
- filter: "numberISRITM11172625" → Find by number
- filter: "stateISapproved" → Find by state
- filter: "assigned_toISjohn.doe@example.com" → Find by assignment
```

### Tool: get_sc_req_item

```
Description: Get a specific request item by sys_id
ServiceNow Table: sc_req_item

Input Schema:
{
  recordId: string (required) - ServiceNow sys_id
}

Output:
{
  success: boolean
  data: record object
}
```

### Tool: create_sc_req_item

```
Description: Create a new request item
ServiceNow Table: sc_req_item

Input Schema:
{
  fields: object (required) - Record fields to set
}

Supported Fields (examples):
{
  "short_description": "string",
  "description": "string",
  "assigned_to": "string",
  "state": "string",
  "urgency": "1-5 (1=high, 5=low)"
}

Output:
{
  success: boolean
  id: string (sys_id of created record)
  number: string (RITM number assigned by ServiceNow)
  data: record object
}
```

### Tool: update_sc_req_item

```
Description: Update an existing request item
ServiceNow Table: sc_req_item

Input Schema:
{
  recordId: string (required) - ServiceNow sys_id
  fields: object (required) - Fields to update
}

Supported Fields:
{
  "state": "new|in_progress|approved|rejected|closed",
  "short_description": "string",
  "description": "string",
  "assigned_to": "string",
  "urgency": "1-5"
}

Output:
{
  success: boolean
  data: updated record object
}
```

### Tool: delete_sc_req_item

```
Description: Delete a request item
ServiceNow Table: sc_req_item

Input Schema:
{
  recordId: string (required) - ServiceNow sys_id to delete
}

Output:
{
  success: boolean
  message: string (confirmation message)
}
```

## Authentication Flow

### Local Development

```
.env file (SNOW_URL, SNOW_USER, SNOW_PASSWORD)
  ↓
environment.js (loads and validates)
  ↓
index.js (Express server starts)
  ↓
snow-connector.js (initializeSnowClient)
  ├─ Tries BTP Destination Service first
  └─ Falls back to environment variables
  ↓
axios.create() with Basic Auth (username:password)
  ↓
ServiceNow API (HTTPS)
```

### Production (SAP BTP Cloud Foundry)

```
Deployment Time:
  manifest.yml (binds apicall-destination-service)
    ↓
    SAP BTP Destination Service instance bound
    ↓
    VCAP_SERVICES environment variable populated

Runtime:
  index.js (Express server starts)
    ↓
  getDestinationFromBTP() called on first request
    ├─ Step 1: Read VCAP_SERVICES from environment
    ├─ Step 2: Extract destination service credentials
    ├─ Step 3: Derive UAA URL (https://uaa.eu10.hana.ondemand.com)
    ├─ Step 4: Exchange client credentials for OAuth2 token
    │  POST /oauth/token
    │  auth: {clientid, clientsecret}
    ├─ Step 5: Call Destination Service API
    │  GET /destination-configuration/v1/destinations/snow_gen
    │  header: Authorization: Bearer {access_token}
    ├─ Step 6: Parse response
    │  Extract: destinationConfiguration.URL
    │  Extract: destinationConfiguration.User (username)
    │  Extract: destinationConfiguration.Password (password)
    └─ Step 7: Cache credentials in snowClient (singleton)
    ↓
  axios.create() with Basic Auth
    ↓
  ServiceNow API (HTTPS)
```

### Credential Caching

```
First Request:
  getDestinationFromBTP() → Fetches from BTP Destination Service
  Creates: snowClient (axios instance) → Cached in memory
  
Subsequent Requests:
  initializeSnowClient() → Checks if snowClient exists
  Returns: Cached snowClient (no additional BTP calls)
  
Result:
  - First request: ~1-2 seconds (OAuth + API call)
  - Subsequent requests: ~100-500ms (direct ServiceNow call)
```

## Error Handling

### Error Scenarios

```
1. Missing Credentials
   → Application fails to start
   → Clear error message logged

2. ServiceNow Connection Failed
   → MCP tools return error response
   → Joule informs user

3. Invalid Tool Arguments
   → Schema validation fails
   → Error response with details

4. ServiceNow API Error
   → HTTP error caught
   → Error message extracted
   → Returned to Joule

5. Network Timeout
   → Axios timeout (30s)
   → Error response
   → Joule retries possible
```

## Security Architecture

### Authentication Layers

1. **Joule ↔ MCP Server**
   - MCP Protocol (secure transport)
   - Application-level auth (optional)

2. **MCP Server ↔ ServiceNow**
   - HTTPS (encrypted transport)
   - Basic Authentication (username:password)
   - Destination Service manages credentials

3. **Credential Storage**
   - Local: .env file (development only)
   - Production: SAP Destination Service
   - Never committed to git

### Security Best Practices

```
✓ All communication over HTTPS
✓ Credentials in Destination Service
✓ Basic Auth only over secure channel
✓ No credentials in logs
✓ API access scoped to debit memo operations
✓ Audit logging available
✓ Request/response validation
```

## Deployment Architecture

### Local Development

```
Developer Machine
├── Node.js runtime
├── Express.js HTTP server (localhost:4004 or PORT env var)
├── .env file (credentials)
├── POST /mcp endpoint (JSON-RPC)
├── GET /mcp endpoint (tool listing)
└── ServiceNow API (HTTPS + Basic Auth)
```

### Production (SAP BTP Cloud Foundry)

```
SAP BTP Cloud Foundry
├── Application Container (Node.js buildpack)
│   └── Express.js HTTP server (PORT from environment)
│       ├── 5 RITM tools (pre-discovered on startup)
│       ├── Tool cache (in-memory)
│       └── CORS enabled for Joule
│
├── Destination Service (bound via manifest.yml)
│   └── OAuth2 client credentials
│
├── SAP UAA (Token service)
│   └── Access token generation
│
├── Logging Service (cf logs)
│   └── Application logs + network traffic
│
└── SAP Joule (AI Assistant)
    └── Calls /mcp endpoint via HTTPS
```

### High Availability Setup (Future)

```
SAP BTP Cloud Foundry
├── Load Balancer (route distribution)
│   ├── Instance 1 (Express + tools cache)
│   ├── Instance 2 (Express + tools cache)
│   └── Instance 3 (Express + tools cache)
│
├── Destination Service (shared credential store)
│   └── snow_gen destination
│
└── ServiceNow API
    └── All instances use same credentials via Destination Service
```

## Performance Considerations

### Current Configuration

```
Memory: 256MB (SAP BTP)
Disk: 512MB
Instances: 1/1 running
Response Time: ~10-50ms (cached), ~100-500ms (fresh)
Tool Discovery: Pre-cached on startup (~5 tools, 1.3KB)
Timeout: 30s (ServiceNow API calls)
Max Connections: Default (Axios pooling)
```

### Response Sizes

```
tools/list endpoint:
  - Old approach (485 tools): 124KB
  - New approach (5 RITM tools): 1.3KB
  - Improvement: 95% reduction

Benefits:
  - Faster network transfer
  - Quicker Joule integration
  - Reduced memory footprint
```

### Tool Pre-Discovery

```
On Server Startup:
  1. Express server starts
  2. Calls getTools() to pre-discover tools
  3. Caches in memory: mcpTools = [...5 tools...]
  4. Logs: "Created 5 MCP tools"
  5. On ready: "✅ Ready"

Result:
  - First Joule request: ~10ms (from cache)
  - No timeout on initialization
  - Instant tool/list response
```

### Scaling (Future)

```
For increased load:
  - Increase instances: cf scale snow-mcp-server -i 3
  - Increase memory: cf scale snow-mcp-server -m 512M
  - Enable request logging: Add middleware
  - Add rate limiting: Use express-rate-limit

Note: Single table focus (5 tools) makes scaling trivial
```

### Optimization Strategy

```
1. Credential Caching ✓ (Already implemented)
   - Cache snowClient singleton
   - Reuse across requests
   - Reduce OAuth2 token exchanges

2. Tool Caching ✓ (Already implemented)
   - Pre-discover on startup
   - Return from memory on tools/list
   - No database queries needed

3. Connection Pooling ✓ (Axios default)
   - HTTP keep-alive enabled
   - Reuse connections to ServiceNow
   - Reduce connection overhead

4. Response Format
   - Minimal JSON-RPC wrapper
   - No unnecessary serialization
   - Direct pass-through of ServiceNow data
```

## Monitoring and Logging

### Available Logs (with Emojis for Easy Scanning)

```
Application Logs
├── 🚀 Server startup
│   └── "🚀 ServiceNow MCP Server on port 8080"
├── 📍 Endpoints registered
│   └── "📍 POST /mcp - MCP JSON-RPC"
│   └── "📍 GET  /mcp - List tools"
├── 🔍 Pre-discovery
│   ├── "Pre-discovering tools..."
│   ├── "Discovering ServiceNow tables..."
│   └── "Created 5 MCP tools"
├── ✅ Ready status
│   └── "✅ Ready"
├── 📥 Incoming requests
│   └── "📥 POST /mcp { method: 'tools/list', id: 1, hasBody: true }"
├── 🔧 Initialize requests
│   └── "🔧 Initialize"
├── 📢 Notifications
│   └── "📢 Notification: notifications/initialized"
├── 📋 Tool listing
│   └── "📋 Tools list"
├── 🔨 Tool execution
│   └── "🔨 Call: query_sc_req_item"
└── ⚠️ Errors
    └── "Error: [details]"

Access Methods:
  - Local development: console.log output in terminal
  - Production (SAP BTP): cf logs snow-mcp-server --recent
  - Live tail: cf logs snow-mcp-server (Ctrl+C to stop)
  - SAP BTP Logs Service: UI-based log browsing
```

### Key Metrics to Monitor

```
1. Application Health
   ├── Uptime: cf app snow-mcp-server (look for "running")
   ├── Memory usage: 58.9M of 256M (current)
   ├── Disk usage: 225.4M of 512M (current)
   └── Instance state: 1/1 running (healthy)

2. MCP Protocol Health
   ├── Initialize requests: Should complete with 200 status
   ├── Tools/list requests: Should return 5 RITM tools, ~1.3KB
   ├── Tools/call requests: Should execute successfully
   └── Notification handling: Should return 200 (no body)

3. ServiceNow Connectivity
   ├── Destination Service accessibility
   ├── OAuth2 token generation (first request)
   ├── API response times (typically 100-500ms)
   └── Error rate (should be < 1%)

4. Joule Integration
   ├── Connection status: Should show 5 RITM tools
   ├── Tool availability: All 5 tools should be selectable
   ├── Timeout errors: Should be 0 (pre-discovery prevents this)
   └── Execution success: Tools should execute without errors
```

### Logging Best Practices

```
✓ Check logs after deployment: cf logs snow-mcp-server --recent
✓ Monitor "Created X MCP tools" - should be 5
✓ Verify "✅ Ready" appears in logs
✓ Watch for "📥 POST /mcp" to see incoming requests
✓ Alert on any "Error" or "ERR" in logs
✓ Track "🔨 Call" logs to see tool execution
```

## Future Enhancements

```
Current State: ✅ Production-ready for RITM operations

Potential Enhancements:

1. Multi-Table Support
   - ❌ Currently hardcoded to sc_req_item only
   - Add configuration to support additional tables
   - e.g., sc_request, incident, change_request
   - Use query parameter: ?tables=sc_req_item,incident

2. Advanced Filtering
   - ✓ Already supports ServiceNow query syntax
   - Could add pre-built filter templates
   - e.g., "open_ritms", "assigned_to_me", etc.

3. OAuth2 for ServiceNow (Optional)
   - Current: Basic Auth (sufficient for service accounts)
   - Could implement: OAuth2 Client Credentials
   - Benefit: Better security, token-based auth

4. Request/Response Caching
   - ✓ Already caches tools on startup
   - Could add: Redis cache for query results
   - TTL: Configurable per table
   - Benefit: Reduce ServiceNow API calls

5. Advanced Error Recovery
   - ✓ Already has error handling
   - Could add: Automatic retry logic
   - Could add: Circuit breaker for ServiceNow outages
   - Benefit: Better resilience

6. Request Rate Limiting
   - Add: express-rate-limit middleware
   - Prevent: Tool abuse
   - Benefit: Fair resource sharing

7. Audit Logging
   - ✓ Already logs all requests
   - Could add: Structured logging (JSON format)
   - Could add: Integration with SAP BTP audit service
   - Benefit: Compliance and security tracking

8. Performance Optimization
   - Profile: Identify slow requests
   - Add: Request/response timing middleware
   - Optimize: ServiceNow query performance
   - Benefit: Faster tool execution

9. Request Transformation
   - Pre-processing: Transform Joule arguments
   - Post-processing: Format ServiceNow responses
   - Benefit: Better user experience in Joule

10. MCP Protocol Extensions
    - Implement: Resource discovery
    - Implement: Complex tool arguments
    - Support: Streaming responses for large datasets
```

## Architecture Decisions

```
1. Express.js over CAP
   ✓ Why: Lightweight, MCP-focused, no database overhead
   ✗ Trade-off: Less enterprise features than CAP

2. Single Table Focus (sc_req_item)
   ✓ Why: Focused scope, Joule-specific use case
   ✗ Trade-off: Not a generic ServiceNow connector

3. Hardcoded Table Discovery
   ✓ Why: Fast startup, minimal config
   ✗ Trade-off: Need code change to add tables

4. In-Memory Tool Caching
   ✓ Why: Instant response, no database needed
   ✗ Trade-off: Cache lost on restart

5. BTP Destination Service for Credentials
   ✓ Why: Secure, centralized, enterprise-standard
   ✗ Trade-off: Requires SAP BTP account

6. Pre-Discovery on Startup
   ✓ Why: Prevents timeout on first Joule request
   ✗ Trade-off: Adds 1-2 seconds to startup time

7. JSON-RPC 2.0 over HTTP
   ✓ Why: Standard MCP protocol, HTTPS compatible
   ✗ Trade-off: Less efficient than gRPC/binary
```
