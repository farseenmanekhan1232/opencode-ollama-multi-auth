#!/bin/bash

# Quick isolated test for ollama-multi-auth using project-based config
# This creates a test project with its own opencode.json

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🦙 Ollama Multi-Auth Quick Test${NC}"
echo "======================================"

# Create temp project directory
TEST_DIR=$(mktemp -d)
PROJECT_DIR="$TEST_DIR/test-project"
mkdir -p "$PROJECT_DIR"

echo -e "\n📁 Test project: $PROJECT_DIR"
echo -e "${BLUE}This test uses a project-specific opencode.json${NC}"

# Generate mock keys
KEY1="test-key-1-$(openssl rand -hex 8)"
KEY2="test-key-2-$(openssl rand -hex 8)"
KEY3="test-key-3-$(openssl rand -hex 8)"

echo -e "\n🔑 Generated test keys:"
echo "   Key 1: ${KEY1:0:30}..."
echo "   Key 2: ${KEY2:0:30}..."
echo "   Key 3: ${KEY3:0:30}..."

# Create project-specific config (this overrides global!)
cat > "$PROJECT_DIR/opencode.json" << EOF
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

echo -e "\n✅ Created project-specific opencode.json"

# Create global directories (needed for auth storage)
mkdir -p "$TEST_DIR/.config/opencode"
mkdir -p "$TEST_DIR/.local/share/opencode"
mkdir -p "$TEST_DIR/.opencode"

# Create auth.json in global location (this is where plugin writes to)
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
echo -e "\n${YELLOW}Test Configuration:${NC}"
echo "======================================"
echo -e "${BLUE}Project config (opencode.json):${NC}"
echo "   Location: $PROJECT_DIR/opencode.json"
echo "   Model: ollama-multi/kimi-k2.5"
echo "   Keys configured: 3"
echo "   Recovery window: 5 seconds"
echo ""
echo -e "${BLUE}Global auth (auth.json):${NC}"
echo "   Location: $TEST_DIR/.local/share/opencode/auth.json"
echo "   Current key: Key 1 (active)"
echo ""

# Function to show current key status
show_key_status() {
    if [ -f "$TEST_DIR/.local/share/opencode/auth.json" ]; then
        echo -e "${YELLOW}Current auth.json:${NC}"
        cat "$TEST_DIR/.local/share/opencode/auth.json" | jq . 2>/dev/null || cat "$TEST_DIR/.local/share/opencode/auth.json"
    fi
    
    if [ -f "$TEST_DIR/.opencode/ollama-keys-state.json" ]; then
        echo -e "\n${YELLOW}Key rotation state:${NC}"
        cat "$TEST_DIR/.opencode/ollama-keys-state.json" | jq .keys[] 2>/dev/null || echo "   (state file exists)"
    fi
}

show_key_status

echo -e "\n${GREEN}✓ Test environment ready!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Start OpenCode in project:"
echo -e "   ${GREEN}HOME=$TEST_DIR opencode $PROJECT_DIR${NC}"
echo ""
echo "   Or with debug logging:"
echo -e "   ${GREEN}HOME=$TEST_DIR opencode $PROJECT_DIR --print-logs --log-level DEBUG${NC}"
echo ""
echo "2. Test key rotation:"
echo "   - Select ollama-multi/kimi-k2.5 model"
echo "   - Send messages until rate limit"
echo "   - Watch it switch to next key"
echo ""
echo "3. View key status anytime:"
echo -e "   ${BLUE}cat $TEST_DIR/.local/share/opencode/auth.json${NC}"
echo ""

# Interactive menu
while true; do
    echo -e "${YELLOW}Options:${NC}"
    echo "1) Start OpenCode TUI"
    echo "2) Start with debug logging"
    echo "3) Show current key status"
    echo "4) Simulate key rotation (manual test)"
    echo "5) Clean up and exit"
    echo ""
    read -p "Choose an option (1-5): " choice
    
    case $choice in
        1)
            echo -e "\n🚀 Starting OpenCode TUI...\n"
            HOME="$TEST_DIR" opencode "$PROJECT_DIR" || true
            ;;
        2)
            echo -e "\n🚀 Starting OpenCode with debug logging...\n"
            HOME="$TEST_DIR" opencode "$PROJECT_DIR" --print-logs --log-level DEBUG 2>&1 || true
            ;;
        3)
            echo -e "\n"
            show_key_status
            echo ""
            ;;
        4)
            echo -e "\n${YELLOW}Manual Key Rotation Test${NC}"
            echo "This simulates a key failure and rotation"
            
            # Get current key
            CURRENT_KEY=$(cat "$TEST_DIR/.local/share/opencode/auth.json" | jq -r '.["ollama-multi"].key' 2>/dev/null || echo "")
            
            if [ -n "$CURRENT_KEY" ]; then
                echo "Current key: ${CURRENT_KEY:0:30}..."
                
                # Determine which key is next
                if [[ "$CURRENT_KEY" == "$KEY1" ]]; then
                    NEXT_KEY="$KEY2"
                    NEXT_NUM="2"
                elif [[ "$CURRENT_KEY" == "$KEY2" ]]; then
                    NEXT_KEY="$KEY3"
                    NEXT_NUM="3"
                else
                    NEXT_KEY="$KEY1"
                    NEXT_NUM="1 (cycled back)"
                fi
                
                read -p "Rotate to Key $NEXT_NUM? (y/n): " rotate
                if [[ $rotate =~ ^[Yy]$ ]]; then
                    cat > "$TEST_DIR/.local/share/opencode/auth.json" << EOF
{
  "ollama-multi": {
    "type": "api",
    "key": "$NEXT_KEY"
  }
}
EOF
                    echo -e "${GREEN}✅ Rotated to Key $NEXT_NUM${NC}"
                    show_key_status
                fi
            fi
            echo ""
            ;;
        5)
            echo ""
            read -p "Clean up test environment? (y/n): " cleanup
            if [[ $cleanup =~ ^[Yy]$ ]]; then
                rm -rf "$TEST_DIR"
                echo -e "${GREEN}✅ Cleaned up test environment${NC}"
            else
                echo -e "${YELLOW}💾 Test environment preserved at: $TEST_DIR${NC}"
            fi
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            ;;
    esac
done