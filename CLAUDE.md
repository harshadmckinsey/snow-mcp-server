# ServiceNow MCP Server for SAP Joule

## Project Overview

A lightweight MCP (Model Context Protocol) server that exposes ServiceNow Service Catalog Request Items (RITMs) as tools for SAP Joule integration. The server dynamically discovers and creates MCP-compliant tools for CRUD operations on RITMs.

**Status:** ✅ Production - 5 RITM tools live on SAP BTP Cloud Foundry

## Architecture

```
SAP Joule (AI Assistant)
    ↓ MCP Protocol (HTTP)
Express.js MCP Server (Port 8080)
    ├── POST /mcp - JSON-RPC handler (initialize, tools/list, tools/call)
    └── GET /mcp - Simple tool listing
         ↓
ServiceNow Connector (OAuth2 + Basic Auth)
    ├── Retrieves credentials from SAP BTP Destination Service (snow_gen)
    └── Makes REST calls to ServiceNow API
         ↓
ServiceNow (sc_req_item table)
```

## Key Files

| File | Purpose |
|------|---------|
| `srv/index.js` | Express.js MCP server, JSON-RPC handler, tool pre-discovery |
| `srv/connectors/snow-connector.js` | ServiceNow REST client, credential retrieval from BTP |
| `package.json` | Dependencies (express, axios) |
| `manifest.yml` | Cloud Foundry deployment config |
| `mta.yaml` | MTA deployment manifest (alternative) |

## MCP Tools

The server exposes exactly **5 tools** for Service Catalog Request Items (RITM):

### 1. `query_sc_req_item`
**Query/search RITMs**
```json
{
  "method": "tools/call",
  "params": {
    "name": "query_sc_req_item",
    "arguments": {
      "filter": "numberISRITM11172625",
      "limit": 1
    }
  }
}
```

### 2. `get_sc_req_item`
**Retrieve RITM by sys_id**
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_sc_req_item",
    "arguments": {
      "recordId": "sys_id_here"
    }
  }
}
```

### 3. `create_sc_req_item`
**Create new RITM**
```json
{
  "method": "tools/call",
  "params": {
    "name": "create_sc_req_item",
    "arguments": {
      "fields": {
        "short_description": "My Request",
        "description": "Details here"
      }
    }
  }
}
```

### 4. `update_sc_req_item`
**Update existing RITM**
```json
{
  "method": "tools/call",
  "params": {
    "name": "update_sc_req_item",
    "arguments": {
      "recordId": "sys_id_here",
      "fields": {
        "state": "in_progress"
      }
    }
  }
}
```

### 5. `delete_sc_req_item`
**Delete RITM**
```json
{
  "method": "tools/call",
  "params": {
    "name": "delete_sc_req_item",
    "arguments": {
      "recordId": "sys_id_here"
    }
  }
}
```

## MCP Endpoints

### POST /mcp
JSON-RPC 2.0 endpoint for MCP protocol

**Supported Methods:**
- `initialize` - Initialize connection with client info
- `tools/list` - List all available tools
- `tools/call` - Execute a tool
- `notifications/*` - Handle MCP notifications (no response)

### GET /mcp
Simple HTTP GET to list tools (returns JSON array)

## Credential Retrieval

The server retrieves ServiceNow credentials at runtime from SAP BTP:

1. **Get Destination Service credentials** from `VCAP_SERVICES` environment
2. **Request OAuth2 token** from UAA using client credentials
3. **Fetch destination** (`snow_gen`) from Destination Service API
4. **Extract credentials** from nested `destinationConfiguration` field
5. **Create Axios client** with ServiceNow base URL and Basic Auth

**Fallback:** If BTP destination service is unavailable, reads from environment variables:
- `SNOW_URL` - ServiceNow instance URL
- `SNOW_USER` - ServiceNow username
- `SNOW_PASSWORD` - ServiceNow password

## Deployment

### SAP BTP Cloud Foundry

**Prerequisites:**
- CF CLI installed and authenticated
- Service instance bound: `apicall-destination-service`
- Destination configured: `snow_gen` with ServiceNow credentials

**Deploy:**
```bash
cf push snow-mcp-server --strategy rolling
```

**Current State:**
- **URL:** `https://snow-mcp-server.cfapps.eu10.hana.ondemand.com`
- **Memory:** 256M
- **Disk:** 512M
- **Instances:** 1/1 running
- **Last Updated:** 2026-08-04 13:48:49 UTC

### Local Development

```bash
npm install
cp .env.example .env
# Edit .env with ServiceNow credentials
npm run dev  # Uses nodemon for auto-reload
```

## Testing

### Postman

**Initialize:**
```
POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp
Content-Type: application/json

{
  "method": "initialize",
  "id": 1
}
```

**List Tools:**
```
POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp
Content-Type: application/json

{
  "method": "tools/list",
  "id": 2
}
```

**Query RITM:**
```
POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp
Content-Type: application/json

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
```

### Joule Integration

1. In Joule, configure MCP server: `https://snow-mcp-server.cfapps.eu10.hana.ondemand.com`
2. No authentication required (MCP protocol handles it)
3. Joule should discover the 5 RITM tools automatically
4. Use tools to interact with ServiceNow RITMs

## Key Decisions

| Decision | Reason |
|----------|--------|
| Express.js instead of CAP | Lightweight, no DB needed, simple MCP protocol |
| Hardcoded to sc_req_item only | Focused scope, Joule-specific use case |
| BTP Destination Service | Secure credential management, no hardcoding |
| Pre-discovery on startup | Avoid timeout on first Joule connection |
| MCP notification handling | Proper protocol compliance with Joule gateway |

## Troubleshooting

### Server shows old tools (not 5 RITM tools)
- Check `Created X MCP tools` in logs
- Expected: `Created 5 MCP tools`
- Redeploy: `cf push snow-mcp-server`

### Destination Service API returns 400
- Verify `snow_gen` destination exists in SAP BTP
- Check credentials are correct
- Ensure Destination Service instance is bound (`cf bind-service snow-mcp-server apicall-destination-service`)

### Joule shows "pending" or timeout
- Check server logs: `cf logs snow-mcp-server --recent`
- Verify Joule is sending POST requests to `/mcp` endpoint
- Check if `notifications/initialized` is being handled (look for `📢 Notification` in logs)

### Tools not appearing in Joule
- Wait 30 seconds after deployment for cache refresh
- Check response size is small (~1.3KB for 5 tools), not 124KB
- Verify `tools/list` returns all 5 sc_req_item operations

## Monitoring

Check server health:
```bash
# App status
cf app snow-mcp-server

# Recent logs
cf logs snow-mcp-server --recent

# Watch logs (tail)
cf logs snow-mcp-server
```

**Expected logs:**
```
✅ Ready
📥 POST /mcp { method: 'tools/list', id: 1, hasBody: true }
📋 Tools list
```

## Future Enhancements

- [ ] Add more ServiceNow tables (incidents, changes, etc.)
- [ ] Implement tool result streaming for large responses
- [ ] Add request/response logging middleware
- [ ] Unit tests for connector functions
- [ ] Tool caching with TTL for performance
