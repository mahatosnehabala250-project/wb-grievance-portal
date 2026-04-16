#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Deploy WB-01 Advanced v3.0 to n8n via MCP
# Usage: bash n8n-sdk-v3/deploy-wb01.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

N8N_MCP_URL="https://api.n8n-mcp.com/"
N8N_MCP_TOKEN="nmcp_445a9ce980cb597b622a524b97baed9239167d807296e88b00dbaf749b1a251e"
MCP_ID=1

call_tool() {
  local tool_name=$1
  local tool_args=$2
  local id=${3:-$((MCP_ID++))}
  
  echo "[$(date '+%H:%M:%S')] Calling $tool_name..."
  local response=$(curl -s -m 120 -X POST "$N8N_MCP_URL" \
    -H "Authorization: Bearer $N8N_MCP_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool_name\",\"arguments\":$tool_args}}")
  
  echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
  echo ""
  
  # Check for errors
  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('result',{}).get('isError',False) else 1)" 2>/dev/null; then
    echo "ERROR in response!"
    return 1
  fi
}

SDK_FILE="n8n-sdk-v3/wb-01-whatsapp-intake-advanced.js"

if [ ! -f "$SDK_FILE" ]; then
  echo "ERROR: SDK file not found: $SDK_FILE"
  exit 1
fi

SDK_CODE=$(cat "$SDK_FILE")

# Escape the code for JSON
ESCAPED_CODE=$(python3 -c "
import json, sys
with open('$SDK_FILE', 'r') as f:
    code = f.read()
print(json.dumps(code))
")

echo "═══════════════════════════════════════════════════════════════════"
echo "  WB-01 ADVANCED v3.0 — Deployment Pipeline"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Step 1: Validate
echo "━━━ STEP 1: VALIDATE WORKFLOW ━━━"
call_tool "validate_workflow" "{\"code\":$ESCAPED_CODE}" $((MCP_ID++))

# Step 2: Archive old WB-01 if exists
echo "━━━ STEP 2: ARCHIVE OLD WB-01 ━━━"
echo "Skipping archive — will update if workflow ID is known"
# call_tool "archive_workflow" "{\"workflowId\":\"q07rmlwN6fo0aXoz\"}" $((MCP_ID++))

# Step 3: Create workflow
echo "━━━ STEP 3: CREATE WORKFLOW ━━━"
call_tool "create_workflow_from_code" "{\"code\":$ESCAPED_CODE,\"name\":\"WB-01: WhatsApp Intake + AI Router [ADVANCED v3]\",\"description\":\"Advanced WhatsApp intake with 6-way routing, AI classification, duplicate detection, bilingual messages. 24 nodes.\"}" $((MCP_ID++))

# Step 4: Publish
echo "━━━ STEP 4: PUBLISH WORKFLOW ━━━"
echo "Note: Get workflow ID from Step 3 output, then publish"
# call_tool "publish_workflow" "{\"workflowId\":\"NEW_WORKFLOW_ID_HERE\"}" $((MCP_ID++))

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Deployment Complete!"
echo "  Next: Copy workflow ID from Step 3, update publish command"
echo "═══════════════════════════════════════════════════════════════════"
