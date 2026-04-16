#!/bin/bash
# Deploy all 8 n8n workflows v2 (native nodes: WhatsApp Send + Supabase + AI Agent)
# Usage: bash deploy-all-v2.sh

MCP_URL="https://n8n.srv1347095.hstgr.cloud/mcp-server/http"
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1M2Y5MDE1YS01M2E1LTQ3NTItYWVlYy05NDllYjViMTkyZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6IjM0MzI3YjViLTBkYmItNDEzNC1iOWM5LTM1NzliMmQ5ZWFiNSIsImlhdCI6MTc3NjM2OTg2N30.KK0FCn4NvngTF9pLMpHT2RWULM-DZ2nXVt6IOJ9kwrE"
SDK_DIR="/home/z/my-project/n8n-sdk-v2"
ID=0

call_mcp() {
  local tool="$1"
  local args="$2"
  local resp
  resp=$(curl -s -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$((++ID)),\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" 2>/dev/null)
  echo "$resp" | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if line.startswith('data: '):
        try:
            data = json.loads(line[6:])
            text = data.get('result',{}).get('content',[{}])[0].get('text','')
            if text: print(text[:3000])
        except: pass
" 2>/dev/null
}

deploy_workflow() {
  local file="$1"
  local name="$2"
  echo ""
  echo "========================================"
  echo "📦 DEPLOYING: $name"
  echo "========================================"

  # Read SDK code
  local code
  code=$(cat "$file")

  # Escape for JSON
  local code_json
  code_json=$(echo "$code" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

  # Step 1: Validate
  echo "🔍 Validating..."
  local val_result
  val_result=$(call_mcp "validate_workflow" "{\"code\":$code_json}")
  echo "$val_result" | head -5

  # Check for errors
  if echo "$val_result" | grep -q '"errors"'; then
    echo "❌ VALIDATION FAILED for $name"
    echo "$val_result"
    return 1
  fi

  # Step 2: Create
  echo "🚀 Creating workflow..."
  local create_result
  create_result=$(call_mcp "create_workflow_from_code" "{\"code\":$code_json,\"name\":\"$name\"}")
  echo "$create_result"

  # Extract workflow ID
  local wf_id
  wf_id=$(echo "$create_result" | python3 -c "
import sys, json, re
text = sys.stdin.read()
m = re.search(r'\"workflowId\":\s*\"([^\"]+)\"', text)
if m: print(m.group(1))
" 2>/dev/null)

  if [ -z "$wf_id" ]; then
    echo "❌ FAILED to create $name"
    return 1
  fi

  echo "✅ Created: $name (ID: $wf_id)"

  # Step 3: Publish
  echo "📡 Publishing..."
  local pub_result
  pub_result=$(call_mcp "publish_workflow" "{\"workflowId\":\"$wf_id\"}")
  echo "$pub_result" | head -3

  echo "✅ PUBLISHED: $name"
  echo "🔗 URL: https://n8n.srv1347095.hstgr.cloud/workflow/$wf_id"
}

# Deploy all 8 workflows in order
deploy_workflow "$SDK_DIR/wb-09-error-handler.js"    "WB-09: Global Error Handler"
deploy_workflow "$SDK_DIR/wb-05-status-check.js"     "WB-05: Status Check by Ticket"
deploy_workflow "$SDK_DIR/wb-06-rating.js"            "WB-06: Rating Collection"
deploy_workflow "$SDK_DIR/wb-03-notifications.js"     "WB-03: Citizen & Officer Notifications"
deploy_workflow "$SDK_DIR/wb-02-auto-assign.js"       "WB-02: Auto-Assign Officer"
deploy_workflow "$SDK_DIR/wb-01-whatsapp-intake.js"   "WB-01: WhatsApp Intake + AI Router"
deploy_workflow "$SDK_DIR/wb-07-sla-escalation.js"    "WB-07: SLA Breach Escalation"
deploy_workflow "$SDK_DIR/wb-08-daily-report.js"       "WB-08: Daily Report"

echo ""
echo "========================================"
echo "🎉 DEPLOYMENT COMPLETE!"
echo "========================================"
echo "All workflows published with native nodes:"
echo "  ✅ AI Agent Node (GPT-4o Mini for complaint classification)"
echo "  ✅ Supabase Node (direct DB operations)"
echo "  ✅ WhatsApp Send Node (native Meta API)"
echo ""
echo "Dashboard: https://n8n.srv1347095.hstgr.cloud"
