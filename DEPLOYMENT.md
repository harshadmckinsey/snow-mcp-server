# Deployment Guide

## Overview

Deploy the ServiceNow MCP Server to SAP BTP Cloud Foundry in 5 minutes.

## Prerequisites

- **SAP BTP Account** with Cloud Foundry enabled
- **CF CLI** installed and configured
- **Destination "snow_gen"** created in SAP BTP with ServiceNow credentials
- **Service Instance** `apicall-destination-service` available in your space

## Step 1: Verify ServiceNow Credentials

1. **Ensure destination exists in SAP BTP Cockpit**
   - Navigate to: Connectivity → Destinations
   - Find: `snow_gen`
   - Verify it has:
     - **URL**: Your ServiceNow instance
     - **Username**: API user account
     - **Password**: User password
     - **Authentication**: BasicAuthentication

2. **Test connection in Cockpit**
   - Click on `snow_gen` destination
   - Click "Test Connection"
   - Should show: "Connection successful"

## Step 2: Deploy Application

### Quick Deploy (Recommended)

```bash
cd snow-mcp-server
npm install
cf push snow-mcp-server
```

The `manifest.yml` automatically:
- ✅ Uses nodejs_buildpack
- ✅ Allocates 256MB memory, 512MB disk
- ✅ Binds apicall-destination-service
- ✅ Sets PORT environment variable

### Step-by-Step Deploy

```bash
# 1. Login to Cloud Foundry
cf login -a https://api.cf.eu10.hana.ondemand.com
cf target -o <ORG> -s <SPACE>

# 2. Install dependencies
npm install

# 3. Push application
cf push snow-mcp-server -f manifest.yml

# 4. Monitor deployment
cf logs snow-mcp-server --recent
```

## Step 3: Verify Deployment

### Check App Status

```bash
cf app snow-mcp-server
```

Expected output:
```
name                requested state   instances   memory   disk
snow-mcp-server     started           1/1         256M     512M
```

### Check Logs

```bash
cf logs snow-mcp-server --recent
```

Expected log output:
```
🚀 ServiceNow MCP Server on port 8080
📍 POST /mcp - MCP JSON-RPC
📍 GET  /mcp - List tools
Pre-discovering tools...
Discovering ServiceNow tables...
Created 5 MCP tools
✅ Ready
```

### Get Application URL

```bash
cf app snow-mcp-server | grep routes
```

Example: `https://snow-mcp-server.cfapps.eu10.hana.ondemand.com`

## Step 4: Test the Server

### Test Endpoint Directly

```bash
curl -X POST https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","id":1}'
```

Expected: Returns 5 RITM tools (~1.3KB response)

### Watch Live Logs

```bash
cf logs snow-mcp-server
```

You should see requests logged:
```
📥 POST /mcp { method: 'tools/list', id: 1, hasBody: true }
📋 Tools list
```

## Step 5: Register with SAP Joule

1. **Get Server URL**
   ```bash
   cf app snow-mcp-server | grep routes
   ```

2. **In Joule Settings**
   - Navigate to MCP Servers configuration
   - Add new server:
     - **URL**: `https://snow-mcp-server.cfapps.eu10.hana.ondemand.com`
     - **Authentication**: None (MCP protocol handles it)
   - Click "Test Connection"

3. **Verify Tools Appear**
   - Joule should discover 5 RITM tools
   - Try: *"Show me RITM11172625"*

## Scaling & Performance

### Current Configuration

```
Memory: 256MB (sufficient for 5 RITM tools)
Disk: 512MB
Instances: 1/1
Response Time: ~10-50ms (cached), 100-500ms (ServiceNow)
```

### Scale Up (if needed)

```bash
# Increase instances for load distribution
cf scale snow-mcp-server -i 3

# Increase memory (optional)
cf scale snow-mcp-server -m 512M
```

## Monitoring

### View Live Logs

```bash
# Watch real-time logs
cf logs snow-mcp-server

# View recent logs
cf logs snow-mcp-server --recent

# Filter for specific messages
cf logs snow-mcp-server --recent | grep "Error\|⚠️"
```

### Check Performance

```bash
# Memory/CPU usage
cf stats snow-mcp-server

# Application events
cf events snow-mcp-server
```

### Expected Log Indicators

| Log | Status | Action |
|-----|--------|--------|
| `✅ Ready` | ✅ Healthy | None - normal |
| `Created 5 MCP tools` | ✅ Healthy | None - expected |
| `📥 POST /mcp` | ✅ Requests coming in | None - working |
| `Error` or `ERR` | ⚠️ Problem | Check full logs |
| `0 MCP tools` | ❌ Critical | Redeploy immediately |

## Troubleshooting

### Server Won't Start

```bash
# Check detailed logs
cf logs snow-mcp-server --recent

# Common issues:
# 1. Missing dependencies
#    Solution: npm install (locally), then cf push again

# 2. Port conflict
#    Solution: Check manifest.yml for PORT variable

# 3. Service binding failed
#    Solution: cf bind-service snow-mcp-server apicall-destination-service
```

### No Tools Created (0 MCP tools)

```bash
# This means table discovery failed
# Redeploy the application
cf push snow-mcp-server --strategy rolling

# If still failing, check:
# 1. Destination "snow_gen" exists and is configured
# 2. ServiceNow credentials are correct
# 3. Network access to ServiceNow is allowed
```

### Connection Timeout to ServiceNow

```bash
# Check destination configuration
cf env snow-mcp-server | grep VCAP_SERVICES

# Verify destination manually
# 1. Go to SAP BTP Cockpit
# 2. Connectivity → Destinations
# 3. Click "snow_gen"
# 4. Click "Test Connection"
# 5. Should show "Connection successful"
```

### Joule Shows "Pending" or "Connection Error"

```bash
# 1. Wait 30 seconds (cache refresh)
# 2. Check if URL is correct in Joule settings
# 3. Test endpoint directly:
curl -X POST <your-server-url>/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"initialize","id":1}'

# 4. If that works but Joule still fails:
#    - Restart Joule
#    - Check Joule's network access to your URL
```

## Rollback

```bash
# If deployment has issues:

# Stop current version
cf stop snow-mcp-server

# Delete current version
cf delete snow-mcp-server -f

# Re-deploy previous version
cf push snow-mcp-server
```

## Redeployment

```bash
# To update with new code:

# 1. Make changes locally
# 2. Push update
cf push snow-mcp-server --strategy rolling

# --strategy rolling ensures:
# - New instances start first
# - Old instances stop after new are healthy
# - Zero downtime during update
```

## Environment Variables

The server reads these from Cloud Foundry environment:

```bash
PORT                  # Automatically set by CF (8080 default)
VCAP_SERVICES         # Service binding credentials (auto-populated)
NODE_ENV              # Set to "production" by CF
```

To set custom variables:

```bash
cf set-env snow-mcp-server CUSTOM_VAR value
cf restart snow-mcp-server
```

## Security Best Practices

1. **Credential Storage**
   - ✅ All credentials stored in SAP BTP Destination Service
   - ✅ OAuth2 used for token exchange
   - ✅ No credentials in logs
   - ✅ No credentials in code

2. **Network Security**
   - ✅ HTTPS only (Cloud Foundry provides TLS)
   - ✅ CORS enabled for Joule
   - ✅ No sensitive data in URLs

3. **Maintenance**
   - Regular: `npm audit`
   - Monitor: SAP Joule audit logs
   - Update: CF buildpacks (automatic)

## Health Check

Quick health check script:

```bash
#!/bin/bash
URL="https://snow-mcp-server.cfapps.eu10.hana.ondemand.com/mcp"

echo "Testing MCP Server..."
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","id":1}' \
  -w "\nHTTP Status: %{http_code}\n"

# Expected: HTTP 200 + JSON response with 5 tools
```

## Next Steps

1. ✅ Test all 5 RITM tools in Joule
2. ✅ Monitor logs for first week
3. ✅ Set up backup/disaster recovery
4. ✅ Document custom configurations
5. ✅ Schedule monthly security audits
