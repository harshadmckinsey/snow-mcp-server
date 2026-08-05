# ServiceNow MCP Server for SAP Joule

A lightweight **Express.js** MCP (Model Context Protocol) server that exposes ServiceNow **Request Items (RITM)** as tools for SAP Joule integration.

**Status:** ✅ Production-ready  
**Deployment:** SAP BTP Cloud Foundry  
**Tools:** 5 RITM operations (query, create, get, update, delete)

## Quick Start

### Local Development

```bash
cd snow-mcp-server
npm install
cp .env.example .env
```

Edit `.env` with your ServiceNow credentials:
```env
SNOW_URL=https://your-instance.service-now.com
SNOW_USER=your-username
SNOW_PASSWORD=your-password
```

Run:
```bash
npm run dev
# Server at http://localhost:4004
```

### Production Deployment (SAP BTP)

```bash
cf push snow-mcp-server
# Server at https://snow-mcp-server.cfapps.eu10.hana.ondemand.com
```

## How It Works

### MCP Protocol Flow

```
1. Initialize
   Joule → POST /mcp { "method": "initialize" }
   Server ← Responds with protocol version

2. Tool Discovery
   Joule → POST /mcp { "method": "tools/list" }
   Server ← Returns 5 RITM tools (pre-cached, 1.3KB)

3. Tool Execution
   Joule → POST /mcp { "method": "tools/call", "params": {...} }
   Server → Calls ServiceNow API
   Server ← ServiceNow returns data
   Server ← Responds with results to Joule
```

## Available Tools

All tools operate on ServiceNow **sc_req_item** (Service Catalog Request Items / RITM) table:

### 1. query_sc_req_item
Query/search request items
```json
{
  "filter": "numberISRITM11172625",
  "limit": 1
}
```

### 2. create_sc_req_item
Create new request item
```json
{
  "fields": {
    "short_description": "My Request",
    "description": "Details here"
  }
}
```

### 3. get_sc_req_item
Get request item by ID
```json
{
  "recordId": "sys_id_here"
}
```

### 4. update_sc_req_item
Update request item
```json
{
  "recordId": "sys_id_here",
  "fields": {
    "state": "in_progress"
  }
}
```

### 5. delete_sc_req_item
Delete request item
```json
{
  "recordId": "sys_id_here"
}
```

## Testing

### Using curl

**List tools:**
```bash
curl -X POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","id":1}'
```

**Query RITM:**
```bash
curl -X POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method":"tools/call",
    "id":2,
    "params": {
      "name":"query_sc_req_item",
      "arguments":{
        "filter":"numberISRITM11172625",
        "limit":1
      }
    }
  }'
```

### Using Postman

1. Create new POST request to `/mcp` endpoint
2. Set Body → Raw → JSON
3. Paste JSON-RPC request
4. Click Send

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/mcp` | MCP JSON-RPC handler (initialize, tools/list, tools/call) |
| GET | `/mcp` | Simple tool listing (HTML/JSON) |

## Architecture

```
SAP Joule (AI Assistant)
    ↓ MCP Protocol (JSON-RPC 2.0 over HTTPS)
Express.js Server (Port 8080)
    ├── Request routing & CORS
    ├── MCP protocol handling
    └── Tool pre-discovery & caching
         ↓ OAuth2 + Basic Auth
    SAP BTP Destination Service
         ↓ Credential retrieval
    ServiceNow REST API
         ↓ HTTPS
    sc_req_item table (5 CRUD operations)
```

## Deployment Details

### SAP BTP Configuration

**Destination:** `snow_gen`  
**Authentication:** Basic (username/password)  
**Service Binding:** `apicall-destination-service`

The server retrieves credentials at runtime from SAP BTP Destination Service using OAuth2.

### Current Deployment

```
URL: https://snow-mcp-server.cfapps.eu10.hana.ondemand.com
Memory: 256MB
Disk: 512MB
Instances: 1/1 running
Last Updated: 2026-08-04 13:48:49 UTC
```

## Monitoring

Check server health:
```bash
cf logs snow-mcp-server --recent
```

Look for:
```
✅ Ready                          # Server is ready
Created 5 MCP tools              # Tools successfully created
📥 POST /mcp { method: ...}      # Incoming requests
📋 Tools list                     # Tool listing requests
🔨 Call: query_sc_req_item       # Tool execution
```

## Performance

**Response Sizes:**
- Old approach (485 tools): 124KB
- Current approach (5 RITM tools): 1.3KB
- **95% reduction**

**Response Times:**
- First request: ~10ms (from cache)
- Typical request: 100-500ms (ServiceNow API)
- No timeouts (pre-discovery on startup)

## Key Files

| File | Purpose |
|------|---------|
| `srv/index.js` | Express.js server, MCP handler |
| `srv/connectors/snow-connector.js` | ServiceNow REST client |
| `package.json` | Dependencies |
| `manifest.yml` | Cloud Foundry deployment |
| `ARCHITECTURE.md` | Technical design |
| `CLAUDE.md` | Code documentation |

## Troubleshooting

**Server won't start:**
```bash
npm install
npm start
# Check error messages in logs
```

**Credentials not working:**
- Verify `.env` file (local) or BTP Destination (production)
- Check ServiceNow URL is correct
- Verify username/password are correct

**Joule shows "pending":**
- Wait 30 seconds (cache refresh)
- Check server logs: `cf logs snow-mcp-server --recent`
- Verify Joule can reach the URL

**Only 0 tools showing:**
- Check logs for "Created X MCP tools"
- Should show "Created 5 MCP tools"
- If not, redeploy: `cf push snow-mcp-server`

## ServiceNow Query Syntax

Filter examples:
```
numberISRITM11172625          # Find by RITM number
stateISapproved               # Find by state
assigned_toISjohn.doe@example # Find by assignee
ORDERBYDESCsys_created_on     # Sort by creation date
```

[ServiceNow Query Reference](https://developer.servicenow.com/dev_portal.do)

## Documentation

- **ARCHITECTURE.md** - Technical design and data flows
- **DEPLOYMENT.md** - Detailed deployment guide
- **QUICKSTART.md** - 5-minute quick start
- **CLAUDE.md** - Code reference for Claude Code

## Support

- **ServiceNow API:** https://developer.servicenow.com/
- **SAP Joule:** Contact your SAP administrator
- **Express.js:** https://expressjs.com/
- **MCP Protocol:** https://modelcontextprotocol.io/
