#!/bin/bash
# n8n MCP Workflow Deployment Script
# Deploys all 8 WB workflows using n8n Instance MCP

MCP_URL="https://n8n.srv1347095.hstgr.cloud/mcp-server/http"
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1M2Y5MDE1YS01M2E1LTQ3NTItYWVlYy05NDllYjViMTkyZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6IjM0MzI3YjViLTBkYmItNDEzNC1iOWM5LTM1NzliMmQ5ZWFiNSIsImlhdCI6MTc3NjM2OTg2N30.KK0FCn4NvngTF9pLMpHT2RWULM-DZ2nXVt6IOJ9kwrE"
SDK_DIR="/home/z/my-project/n8n-sdk"
REQ_ID=100

mcp_call() {
  local tool="$1"
  local args="$2"
  REQ_ID=$((REQ_ID + 1))
  
  local result
  result=$(jq -n --argjson args "$args" '{
    jsonrpc: "2.0",
    id: '$REQ_ID',
    method: "tools/call",
    params: { name: "'$tool'", arguments: $args }
  }' | curl -s -X POST "$MCP_URL" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d @- 2>&1)
  
  # Extract text content from SSE response
  echo "$result" | grep '^data:' | head -1 | sed 's/^data: //' | jq -r '.result.content[0].text // empty' 2>/dev/null || echo "$result"
}

validate_and_create() {
  local name="$1"
  local file="$2"
  local wf_name="$3"
  local wf_desc="$4"
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 $name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Read code from file
  local code
  code=$(jq -Rs '.' < "$file")
  
  # Step 1: Validate
  echo "🔍 Validating..."
  local val_result
  val_result=$(mcp_call "validate_workflow" "{\"code\": $code}" 2>&1)
  echo "   Result: $(echo "$val_result" | head -c 200)"
  
  # Step 2: Create
  echo "🚀 Creating workflow..."
  local create_result
  create_result=$(mcp_call "create_workflow_from_code" "{\"code\": $code, \"name\": \"$wf_name\", \"description\": \"$wf_desc\"}" 2>&1)
  echo "   Result: $(echo "$create_result" | head -c 300)"
  
  # Extract workflow ID
  local wf_id
  wf_id=$(echo "$create_result" | jq -r '.workflowId // .id // empty' 2>/dev/null)
  if [ -z "$wf_id" ] || [ "$wf_id" = "null" ]; then
    # Try parsing from text content
    wf_id=$(echo "$create_result" | grep -oP '"workflowId"\s*:\s*"\K[^"]+' | head -1)
  fi
  
  if [ -n "$wf_id" ] && [ "$wf_id" != "null" ]; then
    echo "   ✅ Workflow ID: $wf_id"
    
    # Step 3: Publish
    echo "📡 Publishing..."
    local pub_result
    pub_result=$(mcp_call "publish_workflow" "{\"workflowId\": \"$wf_id\"}" 2>&1)
    echo "   Publish: $(echo "$pub_result" | head -c 200)"
  else
    echo "   ❌ Failed to create workflow"
    echo "   Full result: $create_result"
  fi
  
  echo ""
}

echo "╔══════════════════════════════════════════════╗"
echo "║  WB Grievance Portal — n8n SDK Deployment    ║"
echo "║  Building 8 workflows via MCP               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Deploy in dependency order
validate_and_create "WB-09" "$SDK_DIR/wb-09-error-handler.js" "WB-09: Global Error Handler" "Catches all workflow errors, logs to DB, alerts admins"
validate_and_create "WB-05" "$SDK_DIR/wb-05-status-check.js" "WB-05: Status Check by Ticket" "Citizen sends WB-XXXXX → query DB → reply status"
validate_and_create "WB-06" "$SDK_DIR/wb-06-rating.js" "WB-06: Rating Collection" "Citizen replies 1-5 → validate → update satisfaction rating"
validate_and_create "WB-02" "$SDK_DIR/wb-02-auto-assign.js" "WB-02: Auto-Assign Officer" "Find matching officer by block → assign → notify"
validate_and_create "WB-03" "$SDK_DIR/wb-03-notifications.js" "WB-03: Citizen & Officer Notifications" "Dual notification engine for status changes and escalations"
validate_and_create "WB-07" "$SDK_DIR/wb-07-sla-escalation.js" "WB-07: SLA Breach Escalation" "Every 2h → check breaches → escalate → alert admins"
validate_and_create "WB-08" "$SDK_DIR/wb-08-daily-report.js" "WB-08: Daily Report" "Daily 9AM IST → aggregate stats → send to admins"
validate_and_create "WB-01" "$SDK_DIR/wb-01-whatsapp-intake.js" "WB-01: WhatsApp Intake + AI Router" "Main entry point — parse → AI classify → route → create → assign"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
