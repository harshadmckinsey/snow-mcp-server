# ServiceNow MCP Server for SAP Joule

## Project Overview

A lightweight Express.js MCP (Model Context Protocol) proxy that bridges SAP Joule to ServiceNow's standard ITSM MCP server. This proxy handles OKTA token generation and forwards all MCP requests to the standard ServiceNow MCP server.

**Status:** ✅ Production - Standard ServiceNow MCP Server Integration

**Integration Pattern:** Joule → BTP-hosted MCP Proxy (OKTA token generation) → ServiceNow Standard MCP Server

## Architecture

```
SAP Joule (AI Assistant)
    ↓ MCP Protocol via BTP Destination (OAuth2 Client Credentials)
Express.js MCP Proxy on BTP Cloud Foundry (Port 8080)
    ├── POST /mcp - JSON-RPC 2.0 handler (initialize, tools/list, tools/call)
    └── GET /mcp - List tools
         ↓
OKTA Token Generation
    ├── Retrieves OKTA credentials from BTP Destination Service (okta_gen)
    ├── Generates access token for standard MCP server
    └── Caches token (5-min buffer for expiry)
         ↓
ServiceNow Standard MCP Server
    ├── URL: https://mckinseydev.service-now.com/sncapps/mcp-server/mcp/servicenow_itsm_mcp_server
    ├── Authentication: Bearer token (OKTA)
    └── Returns all available ServiceNow ITSM tools
```

### Architecture Rationale

- ✅ **Standard MCP server**: Uses ServiceNow's native ITSM MCP server instead of custom REST calls
- ✅ **OKTA authentication**: Generates tokens to call the standard server
- ✅ **Tool discovery**: Dynamically fetches all available tools from the standard server (not hardcoded)
- ✅ **Token caching**: Efficient token reuse with automatic refresh on expiry
- ✅ **Tool proxying**: Transparent proxying of all MCP tool calls to the standard server

## Key Files

| File | Purpose |
|------|---------|
| `srv/index.js` | Express.js MCP proxy, JSON-RPC handler, tool discovery from standard server |
| `srv/connectors/standard-mcp-connector.js` | Calls standard MCP server, manages OKTA token generation/caching |
| `srv/connectors/okta-connector.js` | OKTA token validation and configuration retrieval from BTP |
| `package.json` | Dependencies (express, axios, jsonwebtoken) |
| `.env.example` | Configuration template with OKTA credentials |

## MCP Tools

The proxy discovers and forwards all tools from the ServiceNow standard MCP server. Tool availability depends on ServiceNow instance configuration.

**Example tools provided by standard MCP server:**
- Incident management (create, query, update, close incidents)
- Change management (create, query, update changes)
- Service Catalog Request Items (query, create, get, update, delete RITMs)
- And more depending on standard server configuration

### Example: Query Incidents via Standard Server

```json
{
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "servicenow_itsm_mcp_server-query_incident",
    "arguments": {
      "filter": "stateINopen,in_progress",
      "limit": 10
    }
  }
}
```

**Response:**
- ✅ Returns JSON from standard MCP server (no modification)
- ✅ All standard server tools available through proxy

## MCP Endpoints

### POST /mcp
JSON-RPC 2.0 endpoint for MCP protocol

**Supported Methods:**
- `initialize` - Initialize connection with client info
- `tools/list` - Fetch all tools from standard MCP server
- `tools/call` - Execute a tool (proxied to standard server)
- `notifications/*` - Handle MCP notifications (no response)

### GET /mcp
Simple HTTP GET to list tools (returns all tools from standard server)

## Credential & Token Retrieval

### OKTA Token Generation (Required)
The proxy generates OKTA access tokens to call the standard MCP server:

1. **Get OKTA configuration** from SAP BTP Destination Service (`okta_gen`) or environment variables
2. **Request access token** from OKTA token endpoint using client credentials
3. **Cache token** with 5-minute expiry buffer (automatic refresh on expiry)
4. **Use token** in Bearer Authorization header for standard MCP server calls

**OKTA Destination Configuration** (`okta_gen`):
```
Name: okta_gen
Type: HTTP
URL: https://your-org.okta.com
Additional Properties:
  clientid = your-okta-client-id
  clientsecret = your-okta-client-secret
  authServer = default
```

**Fallback Environment Variables:**
- `OKTA_TENANT` - OKTA tenant URL (e.g., https://your-org.okta.com)
- `OKTA_CLIENT_ID` - OKTA OAuth2 client ID
- `OKTA_CLIENT_SECRET` - OKTA OAuth2 client secret
- `OKTA_AUTH_SERVER` - OKTA authorization server (default: `default`)

### Standard MCP Server Configuration
**ServiceNow ITSM MCP Server (DEV):**
- URL: `https://mckinseydev.service-now.com/sncapps/mcp-server/mcp/servicenow_itsm_mcp_server`
- Client ID: `65a7f537e4ad4c419eb1ef297db0f351`
- Authentication: OKTA Bearer Token

## Deployment

### SAP BTP Cloud Foundry

**Prerequisites:**
- CF CLI installed and authenticated
- Service instance bound: `apicall-destination-service`
- Destination configured: `okta_gen` (required for OKTA token generation)

**Deploy:**
```bash
cf push snow-mcp-server --strategy rolling
```

**Current State:**
- **URL:** `https://snow-mcp-server.cfapps.eu10.hana.ondemand.com`
- **Memory:** 256M
- **Disk:** 512M
- **Instances:** 1/1 running
- **Pattern:** MCP proxy with OKTA token caching

### BTP Destination Setup

#### OKTA Destination (`okta_gen`) - Required
1. BTP Cockpit → Subaccount → Connectivity → Destinations
2. Create destination `okta_gen`:
   ```
   Name: okta_gen
   Type: HTTP
   URL: https://your-org.okta.com
   Authentication: Basic Authentication
   User: your-okta-client-id
   Password: your-okta-client-secret
   
   Additional Properties:
   authServer = default
   ```

### Local Development

```bash
npm install
cp .env.example .env
# Edit .env with OKTA credentials
# OKTA_TENANT=https://your-org.okta.com
# OKTA_CLIENT_ID=your-client-id
# OKTA_CLIENT_SECRET=your-client-secret
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

**List Tools (from standard MCP server):**
```
POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp
Content-Type: application/json

{
  "method": "tools/list",
  "id": 2
}
```

**Call Tool (example: query_incident):**
```
POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp
Content-Type: application/json

{
  "method": "tools/call",
  "id": 3,
  "params": {
    "name": "servicenow_itsm_mcp_server-query_incident",
    "arguments": {
      "filter": "stateINopen",
      "limit": 10
    }
  }
}
```

### Joule Integration

1. In Joule, configure MCP server: `https://snow-mcp-server.cfapps.eu10.hana.ondemand.com`
2. No authentication required (MCP protocol handles it)
3. Joule discovers all tools from standard MCP server automatically
4. Use any ServiceNow ITSM tools available in standard server

## Key Decisions

| Decision | Reason |
|----------|--------|
| Standard MCP server integration | Use ServiceNow's native ITSM MCP server instead of custom REST calls |
| OKTA token generation | Secure authentication to standard MCP server, supports user identity context |
| Token caching with TTL | Efficient token reuse, automatic refresh on expiry, 5-min buffer |
| Tool discovery from server | Dynamic tool list from standard server (not hardcoded) |
| Express.js proxy | Lightweight, stateless, simple MCP protocol forwarding |
| BTP Destination Service | Secure credential storage for OKTA config, no hardcoding secrets |
| Thin proxy approach | Minimal transformation, transparent proxying of all MCP calls |

## Integration Details ✅

**Standard MCP Server:**
- ServiceNow ITSM MCP Server (DEV): `https://mckinseydev.service-now.com/sncapps/mcp-server/mcp/servicenow_itsm_mcp_server`
- Client ID: `65a7f537e4ad4c419eb1ef297db0f351`
- Authentication: OKTA Bearer Token (OAuth2 Client Credentials flow)

**Token Flow:**
1. Proxy uses OKTA client credentials to get access token
2. Token is cached with automatic refresh (5-min buffer before expiry)
3. Token is sent in Bearer Authorization header to standard MCP server
4. Standard server validates token and processes MCP request

## Troubleshooting

### OKTA Token Generation Fails
- Verify `okta_gen` destination exists in SAP BTP Cockpit → Connectivity → Destinations
- Check OKTA credentials are correct (Client ID, Client Secret, Tenant URL)
- Ensure Destination Service instance is bound: `cf bind-service snow-mcp-server apicall-destination-service`
- Check OKTA auth server is accessible: `curl https://your-org.okta.com/oauth2/default/v1/token` (should return 401)
- Verify environment variables set correctly if using fallback (OKTA_TENANT, OKTA_CLIENT_ID, OKTA_CLIENT_SECRET)

### Cannot Reach Standard MCP Server
- Verify URL: `https://mckinseydev.service-now.com/sncapps/mcp-server/mcp/servicenow_itsm_mcp_server`
- Check network connectivity from BTP to ServiceNow (proxy/firewall issues)
- Verify OKTA token is valid (check Bearer token format in logs)
- Try calling standard MCP server directly with OKTA token

### No Tools Returned from Standard MCP Server
- Check standard MCP server URL is correct and accessible
- Verify OKTA token has correct scopes (servicenow)
- Check ServiceNow instance has ITSM MCP server enabled
- Review standard MCP server logs in ServiceNow

### Joule shows "pending" or timeout
- Check server logs: `cf logs snow-mcp-server --recent`
- Look for `🔍 Discovering tools` or `📤 Calling standard MCP` in logs
- Verify proxy can reach standard MCP server (network/firewall)
- Check OKTA token generation is succeeding (look for `✅ New OKTA token obtained`)

### Tool Execution Fails in Joule
- Check tool name format (should be `servicenow_itsm_mcp_server-<tool_name>`)
- Verify proxy is forwarding request correctly (check logs for `🔨 Calling tool via standard MCP`)
- Check standard MCP server response (proxy forwards response unchanged)

## Monitoring

Check proxy health:
```bash
# App status
cf app snow-mcp-server

# Recent logs
cf logs snow-mcp-server --recent

# Watch logs (tail)
cf logs snow-mcp-server
```

**Expected startup logs:**
```
🚀 ServiceNow MCP Proxy Server on port 4004
📍 POST /mcp - MCP JSON-RPC (initialize, tools/list, tools/call)
📍 GET  /mcp - List tools
🔌 Proxying to: https://mckinseydev.service-now.com/sncapps/mcp-server/mcp/servicenow_itsm_mcp_server
Pre-discovering tools from standard MCP server...
✅ New OKTA token obtained (expires in 3600s)
✅ Discovered XX tools from standard MCP server
✅ Ready
```

## Next Steps & Action Items

### Immediate (Current Phase)
- ✅ MCP proxy integrated with standard ServiceNow MCP server
- ✅ OKTA token generation and caching working
- ✅ Tool discovery from standard server functional
- ⏳ **Test Joule integration** with standard server tools
- ⏳ **Verify tool execution** end-to-end through proxy

### Short-term (Next Sprint)
- [ ] Implement request/response logging middleware
- [ ] Add tool result validation and transformation layer (if needed)
- [ ] Implement circuit breaker for standard MCP server calls
- [ ] Unit tests for standard-mcp-connector
- [ ] Performance testing: token caching, tool discovery latency

### Medium-term (Future)
- [ ] Add per-user token generation for user context propagation
- [ ] Implement token refresh queue to avoid expiry edge cases
- [ ] Tool result caching with TTL
- [ ] Webhook/event subscription for downstream Joule notifications
- [ ] Multi-region fallover if standard MCP server has HA requirement

### Known Limitations
- Depends on standard MCP server availability (single point of failure)
- OKTA configuration must be available at startup (no graceful degradation)
- No audit logging of tool calls (audit is on standard MCP server)
- Token caching is memory-based (not shared across instances)
