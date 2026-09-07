# ServiceNow MCP Server for SAP Joule

## Project Overview

A lightweight MCP (Model Context Protocol) server that exposes ServiceNow Service Catalog Request Items (RITMs) as tools for SAP Joule integration. This is a **BTP-hosted MCP proxy** that bridges Joule (OAuth2 Client Credentials) to ServiceNow (service account credentials), following the SAP-recommended architecture for Joule-to-non-SAP MCP connectivity.

**Status:** ✅ Production - Custom BTP MCP Proxy Pattern (as recommended by SAP Support)

**Reference:** Aligns with SAP Community blog "Building an Autonomous SAP Joule Agent for ServiceNow ITSM on SAP BTP" (May 2026)

## Architecture

```
SAP Joule (AI Assistant)
    ↓ MCP Protocol via BTP Destination (OAuth2 Client Credentials)
Express.js MCP Proxy on BTP Cloud Foundry (Port 8080)
    ├── POST /mcp - JSON-RPC 2.0 handler (initialize, tools/list, tools/call)
    └── GET /mcp - Simple tool listing
         ↓
ServiceNow Connector (Basic Auth Service Account)
    ├── Retrieves credentials from SAP BTP Destination Service (snow_gen)
    ├── Service account credentials (not user identity)
    └── Makes REST calls to ServiceNow API
         ↓
ServiceNow APIs
    ├── sc_req_item (RITMs)
    └── sc_item_option_mtom (Questionnaire/Form Answers)
```

### Why This Architecture?

Per SAP Support guidance (mid-2026):
- ✅ **No native ServiceNow MCP connector**: The ServiceNow native MCP server requires Authorization Code flow, incompatible with Joule's OAuth2 Client Credentials
- ✅ **Custom proxy required**: BTP-hosted MCP proxy handles the auth gap — Joule → OAuth2CC → Proxy → ServiceNow Basic Auth
- ✅ **Service account credentials**: Simpler than IAS/OKTA token exchange; sufficient for automated RITM operations
- ✅ **User identity propagation**: Not needed for current use case (automated requests); can add IAS/OKTA later if required

## Key Files

| File | Purpose |
|------|---------|
| `srv/index.js` | Express.js MCP server, JSON-RPC handler, tool pre-discovery |
| `srv/connectors/snow-connector.js` | ServiceNow REST client, credential retrieval from BTP |
| `package.json` | Dependencies (express, axios) |
| `manifest.yml` | Cloud Foundry deployment config |
| `mta.yaml` | MTA deployment manifest (alternative) |

## MCP Tools

The server exposes **7 tools** for Service Catalog Request Items (RITM):

### Generic CRUD Operations

| Tool | Operation | Description |
|------|-----------|-------------|
| `query_sc_req_item` | Search RITMs | Filter and find multiple RITMs using ServiceNow query syntax |
| `get_sc_req_item` | Retrieve RITM | Fetch complete RITM details including questionnaire answers |
| `create_sc_req_item` | Create RITM | Create new RITM with specified fields |
| `update_sc_req_item` | Update RITM | Modify specific fields of existing RITM |
| `delete_sc_req_item` | Delete RITM | Permanently delete an RITM record |

### Specialized RITM Operations

| Tool | Operation | Description |
|------|-----------|-------------|
| `comment_sc_req_item` | Add Comment | Append comments to RITM record |
| `close_sc_req_item` | Close RITM | Complete RITM with closing notes (state=3) |

### Example: Get RITM with Questionnaire Answers

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_sc_req_item",
    "arguments": {
      "recordId": "f2f9eb24a4900350116760bd2b595a83"
    }
  }
}
```

**Response includes:**
- ✅ Complete RITM record (all fields)
- ✅ Questionnaire answers array (sc_item_option_mtom)
- ✅ Form question text, type, and user values

### Example: Close RITM

```json
{
  "method": "tools/call",
  "params": {
    "name": "close_sc_req_item",
    "arguments": {
      "recordId": "f2f9eb24a4900350116760bd2b595a83",
      "closeNotes": "SAP: fulfilled. 2L period opening completed for IN12."
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

### ServiceNow Credentials
The server retrieves ServiceNow credentials at runtime from SAP BTP Destination Service (`snow_gen`):

1. **Get Destination Service credentials** from `VCAP_SERVICES` environment
2. **Request OAuth2 token** from UAA using client credentials
3. **Fetch destination** (`snow_gen`) from Destination Service API
4. **Extract credentials** (URL, username, password)
5. **Create Axios client** with Basic Auth

**Fallback:** If BTP destination unavailable, reads from environment variables:
- `SNOW_URL` - ServiceNow instance URL
- `SNOW_USER` - ServiceNow username
- `SNOW_PASSWORD` - ServiceNow password

### OKTA Credentials (User Token Propagation)
**Phase 1 (OKTA Support)** retrieves OKTA configuration from BTP Destination Service (`okta_gen`):

1. Same flow as ServiceNow: Get token from UAA
2. **Fetch destination** (`okta_gen`) from Destination Service API
3. **Extract credentials** (Tenant URL, Client ID, Client Secret, Auth Server)
4. **Create OKTA token exchange client**

**Fallback:** If BTP destination unavailable, reads from environment variables:
- `OKTA_TENANT` - OKTA tenant URL (e.g., https://your-org.okta.com)
- `OKTA_CLIENT_ID` - OKTA OAuth2 client ID
- `OKTA_CLIENT_SECRET` - OKTA OAuth2 client secret
- `OKTA_AUTH_SERVER` - OKTA authorization server (default: `default`)

## Deployment

### SAP BTP Cloud Foundry

**Prerequisites:**
- CF CLI installed and authenticated
- Service instance bound: `apicall-destination-service`
- Destinations configured:
  - `snow_gen` - ServiceNow credentials (required)
  - `okta_gen` - OKTA credentials (optional, for user token propagation)

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

### BTP Destination Setup

#### ServiceNow Destination (`snow_gen`)
1. BTP Cockpit → Subaccount → Connectivity → Destinations
2. Create/Edit destination `snow_gen`:
   ```
   Name: snow_gen
   Type: HTTP
   URL: https://your-instance.service-now.com
   Authentication: Basic Authentication
   User: service-account-username
   Password: service-account-password
   ```

#### OKTA Destination (`okta_gen`) - For User Token Propagation
1. BTP Cockpit → Subaccount → Connectivity → Destinations
2. Create destination `okta_gen`:
   ```
   Name: okta_gen
   Type: HTTP
   URL: https://your-org.okta.com
   Authentication: OAuth2 Mutual TLS (or Basic)
   
   Additional Properties:
   clientid = your-okta-client-id
   clientsecret = your-okta-client-secret
   authServer = default
   tokenServiceURL = https://your-org.okta.com/oauth2/default/v1/token
   ```

### Local Development

```bash
npm install
cp .env.example .env
# Edit .env with ServiceNow AND OKTA credentials (if testing locally)
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
| BTP-hosted MCP proxy | SAP-recommended pattern for Joule-to-non-SAP connectivity (mid-2026) |
| Express.js instead of CAP | Lightweight, no DB needed, simple MCP protocol |
| RITM-focused scope | Joule use case for SAP finance integration (2L period openings) |
| Service account credentials | Simpler auth; sufficient for automated operations without user context |
| BTP Destination Service | Secure credential management, no hardcoding |
| Pre-discovery on startup | Avoid timeout on first Joule connection |
| Questionnaire inclusion | Complete RITM details including form answers in single call |
| Specialized close/comment ops | Efficient operations for common workflows |

## SAP Support Validation ✅

**Per SAP Support (August 2026):**

> "The recommended path is: Build a custom BTP-hosted MCP proxy that Joule connects to via OAuth2ClientCredentials (which Joule supports). The proxy handles downstream authentication to ServiceNow — either via service account credentials (simpler) or via IAS/OKTA-mediated token exchange (if user identity propagation is needed)."

**Current Implementation Status:**
- ✅ Custom BTP-hosted MCP proxy deployed on Cloud Foundry
- ✅ Joule connects via BTP Destination (OAuth2 Client Credentials)
- ✅ Proxy authenticates to ServiceNow via service account (Basic Auth)
- ✅ Aligned with SAP Community blog pattern (May 2026)
- ⏳ Future: Add IAS/OKTA token exchange if user identity propagation needed

**Reference Architecture:**
- SAP Community: "Building an Autonomous SAP Joule Agent for ServiceNow ITSM on SAP BTP" (May 2026)
- SAP Learning Hub: https://architecture.learning.sap.com/docs/ref-arch/137800#security

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

## Next Steps & Action Items

### Immediate (Current Phase)
- ✅ MCP server deployed and functional on BTP
- ✅ 7 RITM tools live (CRUD + comment + close)
- ✅ Questionnaire answers included in get_sc_req_item
- ⏳ **Test Joule integration** with `/mcp` path (bypass BTP endpoint validation if needed)
- ⏳ **Verify tool descriptions** prevent agent selection prompts in Joule

### Short-term (Next Sprint)
- [ ] Add incident support (comment, resolve) if needed
- [ ] Implement request/response logging middleware
- [ ] Add tool result pagination for large response sets
- [ ] Unit tests for connector functions

### Medium-term (Future)
- [ ] Add more ServiceNow tables (incidents, changes, CHG, etc.)
- [ ] Implement IAS/OKTA token exchange if user identity propagation required
- [ ] Tool result streaming for large responses
- [ ] Tool caching with TTL for performance
- [ ] Webhook/event subscription for downstream Joule notifications

### Known Limitations
- Service account credentials (no user context in ServiceNow)
- RITM-only scope (can expand to incidents/changes)
- No audit logging to ServiceNow (only via REST API)
