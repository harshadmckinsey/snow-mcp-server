# Quick Start - ServiceNow RITM MCP Server

Get the MCP server running and connected to Joule in 5 minutes.

## Local Development (3 minutes)

### 1. Install Dependencies

```bash
cd snow-mcp-server
npm install
cp .env.example .env
```

### 2. Configure Credentials

Edit `.env` with your ServiceNow instance details:

```env
SNOW_URL=https://your-instance.service-now.com
SNOW_USER=your-username
SNOW_PASSWORD=your-password
```

### 3. Start the Server

```bash
npm run dev
```

Server starts at `http://localhost:4004`

### 4. Test the Server

**List available tools (5 RITM operations):**
```bash
curl -X POST http://localhost:4004/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","id":1}' | jq
```

Expected: Returns 5 tools (query, create, get, update, delete for sc_req_item)

**Query request items:**
```bash
curl -X POST http://localhost:4004/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method":"tools/call",
    "id":2,
    "params": {
      "name":"query_sc_req_item",
      "arguments": {
        "filter": "numberISRITM11172625",
        "limit": 1
      }
    }
  }' | jq
```

**Create a request item:**
```bash
curl -X POST http://localhost:4004/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method":"tools/call",
    "id":3,
    "params": {
      "name":"create_sc_req_item",
      "arguments": {
        "fields": {
          "short_description": "New laptop",
          "description": "Employee needs laptop"
        }
      }
    }
  }' | jq
```

---

## Deploy to SAP BTP (2 minutes)

### 1. Prerequisites

- `cf` CLI installed and authenticated
- Destination `snow_gen` configured in SAP BTP

### 2. Deploy

```bash
cf push snow-mcp-server
```

The `manifest.yml` automatically binds the destination service.

### 3. Verify Deployment

```bash
# Check server status
cf app snow-mcp-server

# View logs
cf logs snow-mcp-server --recent

# Test endpoint
curl -X POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","id":1}'
```

Expected logs:
```
✅ Ready
Created 5 MCP tools
```

---

## Configure SAP Joule

### 1. Add MCP Server in Joule

- **URL:** `https://snow-mcp-server.cfapps.eu10.hana.ondemand.com`
- **Authentication:** None (MCP protocol handles it)

### 2. Verify Tools Appear

Joule should show these 5 tools:
- `query_sc_req_item`
- `create_sc_req_item`
- `get_sc_req_item`
- `update_sc_req_item`
- `delete_sc_req_item`

### 3. Test in Joule

Try: *"Show me request item RITM11172625"*

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `query_sc_req_item` | Search request items by filter |
| `create_sc_req_item` | Create new request item |
| `get_sc_req_item` | Get item by ID |
| `update_sc_req_item` | Update item details |
| `delete_sc_req_item` | Delete request item |

### Query Examples

```
numberISRITM11172625        # Find by RITM number
stateISapproved             # Find by state
assigned_toISjohn.doe@ex    # Find by assignee
ORDERBYDESCsys_created_on   # Sort by creation date
```

---

## Useful Commands

```bash
# Development
npm run dev                    # Start with auto-reload
npm start                      # Production mode

# Deployment
cf push snow-mcp-server        # Deploy to SAP BTP
cf logs snow-mcp-server        # Watch live logs (Ctrl+C to exit)
cf logs snow-mcp-server --recent  # Last 100 lines
cf app snow-mcp-server         # Check app status
cf restart snow-mcp-server     # Restart app

# Testing
curl http://localhost:4004/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","id":1}'
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Service won't start` | Check `.env` has SNOW_URL, SNOW_USER, SNOW_PASSWORD |
| `"0 tools created"` | Redeploy: `cf push snow-mcp-server` |
| `Joule shows "pending"` | Wait 30 seconds, then refresh. Check logs: `cf logs snow-mcp-server --recent` |
| `Connection timeout` | Verify `.env` credentials are correct |
| `Only 0 tools in Joule` | Restart Joule integration after deployment |

---

## Next Steps

- **[README.md](README.md)** - Full documentation
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical design
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Detailed deployment guide
- **[CLAUDE.md](CLAUDE.md)** - Code reference

---

## Example Use Case

**Joule:** *"Create a request for a software license"*

**What happens:**
1. Joule calls `create_sc_req_item` tool
2. Server sends data to ServiceNow
3. ServiceNow creates request item (assigns RITM number)
4. Server returns ID and number to Joule
5. Joule confirms: *"Created request RITM00001234"*
