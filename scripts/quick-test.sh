#!/bin/bash

# Quick isolated test for ollama-multi-auth
# Creates a temporary environment without affecting your main OpenCode setup

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🦙 Ollama Multi-Auth Quick Test${NC}"
echo "======================================"

# Create temp directory
TEST_DIR=$(mktemp -d)
echo -e "\n📁 Test environment: $TEST_DIR"

# Create directory structure
mkdir -p "$TEST_DIR/.config/opencode"
mkdir -p "$TEST_DIR/.local/share/opencode"
mkdir -p "$TEST_DIR/.opencode"

# Generate mock keys
KEY1="test-key-1-$(openssl rand -hex 8)"
KEY2="test-key-2-$(openssl rand -hex 8)"
KEY3="test-key-3-$(openssl rand -hex 8)"

echo -e "\n🔑 Generated test keys:"
echo "   Key 1: ${KEY1:0:30}..."
echo "   Key 2: ${KEY2:0:30}..."
echo "   Key 3: ${KEY3:0:30}..."

# Create config
cat > "$TEST_DIR/.config/opencode/opencode.json" << EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "ollama-multi/kimi-k2.5",
  "provider": {
    "ollama-multi": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://ollama.com/v1"
      },
      "models": {
        "kimi-k2.5": { "id": "kimi-k2.5", "name": "Kimi K2.5", "family": "kimi" },
        "qwen3.5:397b": { "id": "qwen3.5:397b", "name": "Qwen 3.5 397B", "family": "qwen" },
        "gemma4:31b-cloud": { "id": "gemma4:31b-cloud", "name": "Gemma 4 31B", "family": "gemma" }
      }
    }
  },
  "plugin": [
    ["opencode-ollama-multi-auth", {
      "ollamaMultiAuth": {
        "keys": [
          "$KEY1",
          "$KEY2",
          "$KEY3"
        ],
        "failWindowMs": 5000
      }
    }]
  ]
}
EOF

echo -e "\n✅ Created opencode.json"

# Create auth.json
cat > "$TEST_DIR/.local/share/opencode/auth.json" << EOF
{
  "ollama-multi": {
    "type": "api",
    "key": "$KEY1"
  }
}
EOF

echo -e "✅ Created auth.json"

# Show status
echo -e "\n📊 Test Environment Status:"
echo "======================================"
echo -e "${YELLOW}auth.json:${NC}"
cat "$TEST_DIR/.local/share/opencode/auth.json" | jq . 2>/dev/null || cat "$TEST_DIR/.local/share/opencode/auth.json"

echo -e "\n${YELLOW}Plugin config:${NC}"
echo "   Model: ollama-multi/kimi-k2.5"
echo "   Keys configured: 3"
echo "   Recovery window: 5 seconds (for testing)"

echo -e "\n${GREEN}✓ Test environment ready!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Start OpenCode:"
echo -e "   ${GREEN}HOME=$TEST_DIR opencode${NC}"
echo ""
echo "2. Test key rotation:"
echo "   - Use the model until you hit rate limit"
echo "   - Watch it automatically switch keys"
echo ""
echo "3. When done, cleanup:"
echo -e "   ${RED}rm -rf $TEST_DIR${NC}"
echo ""

# Ask to start OpenCode
read -p "Start OpenCode now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "\n🚀 Starting OpenCode...\n"
    echo "======================================"
    HOME="$TEST_DIR" opencode || true
    
    echo -e "\n${YELLOW}OpenCode exited.${NC}"
    read -p "Clean up test environment? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$TEST_DIR"
        echo -e "${GREEN}✅ Cleaned up test environment${NC}"
    else
        echo -e "${YELLOW}💾 Test environment preserved at: $TEST_DIR${NC}"
    fi
else
    echo -e "\n${YELLOW}💾 Test environment preserved at: $TEST_DIR${NC}"
    echo "Run the command above when ready to test."
fi