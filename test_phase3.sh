#!/bin/bash

# Phase 3 API Testing Script
# Test all new endpoints

BASE_URL="http://localhost:4000"
USER_ID="test_user_$(date +%s)"

echo "=== Phase 3 API Tests ==="
echo "Using User ID: $USER_ID"
echo ""

# Test 1: Multi-Step Plan Detection
echo "Test 1: Multi-Step Plan Detection"
echo "=================================="
curl -X POST $BASE_URL/api/solve/plan \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "How do I build a real-time dashboard in React with live data updates?"
  }' | jq .
echo ""

# Test 2: Simple Question (no multi-step)
echo "Test 2: Simple Question Detection"
echo "=================================="
curl -X POST $BASE_URL/api/solve/plan \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the capital of France?"
  }' | jq .
echo ""

# Test 3: Store Message in Memory
echo "Test 3: Store User Message"
echo "============================"
curl -X POST $BASE_URL/api/memory/message \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"role\": \"user\",
    \"content\": \"Write me a Python script to process CSV files\"
  }" | jq .
echo ""

# Test 4: Store AI Response
echo "Test 4: Store AI Response"
echo "=========================="
curl -X POST $BASE_URL/api/memory/message \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"role\": \"assistant\",
    \"content\": \"Here is a Python script that processes CSV files with error handling...\"
  }" | jq .
echo ""

# Test 5: Check Follow-up
echo "Test 5: Detect Follow-up Question"
echo "=================================="
curl -X POST $BASE_URL/api/memory/is-followup \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"prompt\": \"Can you modify that code to handle missing values?\"
  }" | jq .
echo ""

# Test 6: Get Context
echo "Test 6: Get Conversation Context"
echo "=================================="
curl "$BASE_URL/api/memory/context/$USER_ID?depth=5" | jq .
echo ""

# Test 7: Get History
echo "Test 7: Get Conversation History"
echo "=================================="
curl "$BASE_URL/api/memory/history/$USER_ID" | jq .
echo ""

# Test 8: Get Stats
echo "Test 8: Conversation Statistics"
echo "==============================="
curl "$BASE_URL/api/memory/history/$USER_ID" | jq '.stats'
echo ""

# Test 9: Generate Report
echo "Test 9: Start Report Generation"
echo "==============================="
REPORT_ID="report_$(date +%s)"
curl -X POST $BASE_URL/api/reports/generate \
  -H "Content-Type: application/json" \
  -d "{
    \"reportId\": \"$REPORT_ID\",
    \"prompt\": \"Analyze the following sales data and provide insights on trends and recommendations\",
    \"data\": [{\"month\": \"Jan\", \"sales\": 10000}, {\"month\": \"Feb\", \"sales\": 12000}, {\"month\": \"Mar\", \"sales\": 15000}],
    \"userId\": \"$USER_ID\"
  }" | jq .
echo ""

# Test 10: Check Report Status
echo "Test 10: Check Report Status (wait a few seconds...)"
echo "====================================================="
sleep 3
curl "$BASE_URL/api/reports/$REPORT_ID" | jq .
echo ""

# Test 11: Export Conversation
echo "Test 11: Export Conversation as Text"
echo "===================================="
curl "$BASE_URL/api/memory/export/$USER_ID?format=text" 
echo ""
echo ""

# Test 12: Export as JSON
echo "Test 12: Export Conversation as JSON"
echo "===================================="
curl "$BASE_URL/api/memory/export/$USER_ID?format=json" | jq .
echo ""

echo "=== Tests Complete ==="
echo "Cleanup: curl -X DELETE $BASE_URL/api/memory/$USER_ID"
