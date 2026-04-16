#!/bin/bash
# Helper to call n8n-mcp API
N8N_MCP_URL="https://api.n8n-mcp.com/"
N8N_MCP_TOKEN="nmcp_445a9ce980cb597b622a524b97baed9239167d807296e88b00dbaf749b1a251e"
N8N_MCP_ID=${N8N_MCP_ID:-1}

call_mcp() {
  local method=$1
  local params=$2
  local id=${3:-$((N8N_MCP_ID++))}
  
  curl -s -m 120 -X POST "$N8N_MCP_URL" \
    -H "Authorization: Bearer $N8N_MCP_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"$method\",\"params\":$params}"
}

# Call a tool
call_tool() {
  local tool_name=$1
  local tool_args=$2
  local id=${3:-$((N8N_MCP_ID++))}
  
  call_mcp "tools/call" "{\"name\":\"$tool_name\",\"arguments\":$tool_args}" "$id"
}
