# opencode-ollama-multi-auth

[![npm version](https://img.shields.io/npm/v/opencode-ollama-multi-auth)](https://www.npmjs.com/package/opencode-ollama-multi-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Opencode plugin for Ollama Cloud with multiple API keys and automatic failover.

Never run out of API quota again! When one API key fails, the plugin automatically switches to the next one.

## Features

- **Zero-Config Setup** - Automatic configuration during installation
- **Multiple API Keys** - Add unlimited API keys for Ollama Cloud
- **Automatic Failover** - Automatically switches to next key when current one fails (401, 403, 429)
- **Auto Recovery** - Re-enables failed keys after 5 hours (configurable)
- **Seamless Experience** - Works transparently - no manual intervention needed

## Installation

```bash
npm install -g opencode-ollama-multi-auth
```

That's it! The setup script will run automatically and guide you through configuration.

## Quick Start

After installation, you'll see an interactive prompt:

```
🦙 Welcome to opencode-ollama-multi-auth!

This plugin helps you use multiple Ollama Cloud API keys with automatic failover.

Enter your Ollama Cloud API keys (one per line).
Press Enter twice when done.

API Key 1: your-key-1
API Key 2: your-key-2
API Key 3: your-key-3

✅ Setup complete!

✓ Added 3 API key(s)
✓ Configured opencode.json
✓ Initialized auth.json

Restart OpenCode to start using ollama-multi models!
```

**Just restart OpenCode and you're ready to go!**

## Usage

After setup, use any `ollama-multi` model in OpenCode:

```
opencode
# Select model: ollama-multi/kimi-k2.5
# Start chatting!
```

The plugin will automatically:
1. Use the first available API key
2. Detect when a key fails (rate limit, invalid, etc.)
3. Switch to the next key seamlessly
4. Re-enable failed keys after 5 hours

## How It Works

### Automatic Key Management

The plugin monitors your Ollama API requests in real-time:

```
Request 1: Using Key #1 ✅ Success
Request 2: Using Key #1 ✅ Success
Request 3: Using Key #1 ❌ Rate limited (429)
           ↓ Automatic rotation
Request 3: Using Key #2 ✅ Success
Request 4: Using Key #2 ✅ Success
...
```

### Key States

- **Active**: Currently being used for requests
- **Failed**: Temporarily disabled after error (re-enables after 5 hours)
- **Available**: Ready to use when needed

## Managing Your Keys

### Rerun Setup

Need to add more keys or change configuration?

```bash
# Rerun the interactive setup
npx opencode-ollama-multi-setup

# Or directly
opencode-ollama-multi-setup
```

### Manual Configuration

If you prefer manual setup or need advanced configuration:

**1. Add plugin to `~/.config/opencode/opencode.json`:**

```json
{
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
          "your-ollama-api-key-1",
          "your-ollama-api-key-2"
        ],
        "failWindowMs": 18000000,
        "maxRetries": 5
      }
    }]
  ]
}
```

**2. Set initial auth key in `~/.local/share/opencode/auth.json`:**

```json
{
  "ollama-multi": {
    "type": "api",
    "key": "your-first-ollama-key"
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | string[] | [] | Array of API keys to rotate through |
| `failWindowMs` | number | 18000000 | Time in ms before retrying a failed key (default: 5 hours) |
| `maxRetries` | number | 5 | Maximum key rotations per request |

### Adding Keys via Environment Variables

You can also set keys in your shell:

```bash
export OLLAMA_API_KEY="your-first-key"
export OLLAMA_API_KEY_1="your-second-key"
export OLLAMA_API_KEY_2="your-third-key"
```

Keys from environment variables are merged with config keys.

## Adding More Models

The `ollama-multi` provider comes with 3 models pre-configured. To add more:

Edit `~/.config/opencode/opencode.json` and add under `provider.ollama-multi.models`:

```json
"your-model-id": {
  "id": "your-model-id",
  "name": "Display Name",
  "family": "model-family"
}
```

Then use with: `ollama-multi/your-model-id`

## Available Models

Pre-configured models:
- `ollama-multi/kimi-k2.5` - Moonshot Kimi K2.5
- `ollama-multi/qwen3.5:397b` - Alibaba Qwen 3.5 397B
- `ollama-multi/gemma4:31b-cloud` - Google Gemma 4 31B

## Troubleshooting

### "Unauthorized" Error

1. **Verify your keys work**:
   ```bash
   curl -H "Authorization: Bearer YOUR_KEY" https://ollama.com/v1/models
   ```

2. **Check auth.json exists**:
   ```bash
   cat ~/.local/share/opencode/auth.json
   ```
   Should contain an `ollama-multi` entry.

3. **Restart OpenCode** after any configuration changes

### Setup Script Didn't Run

If the interactive setup didn't run during install:

```bash
npx opencode-ollama-multi-setup
```

### Keys Not Rotating

1. Verify multiple keys are configured:
   ```bash
   grep -A5 "ollamaMultiAuth" ~/.config/opencode/opencode.json
   ```

2. Check plugin is loaded: Look for `[ollama-multi]` logs in OpenCode

3. Verify state file: `~/.opencode/ollama-keys-state.json`

### Understanding Key Rotation

To see rotation in action:

1. Use up one key's quota
2. Watch the logs (run OpenCode with `--verbose`)
3. Next request automatically uses next key

## State Management

The plugin maintains two files:

- **`~/.local/share/opencode/auth.json`** - Current active key (managed by plugin)
- **`~/.opencode/ollama-keys-state.json`** - Key failure history and rotation state

**Don't edit these manually** - the plugin manages them automatically.

## Testing

### Quick Test Script

Use the provided test script to verify key rotation:

```bash
# Navigate to your plugin directory
cd /path/to/opencode-ollama-multi-auth

# Run the quick test
chmod +x scripts/test-with-project.sh
./scripts/test-with-project.sh
```

This creates an isolated test environment with:
- A test project with its own `opencode.json`
- Mock API keys for testing
- Interactive menu to:
  - Start OpenCode TUI
  - View key status
  - Manually rotate keys to see the state changes

### Project-Based Testing

The script uses a project-specific `opencode.json` which overrides your global config:

1. Creates a temporary test project directory
2. Generates mock API keys
3. Sets up isolated auth.json
4. Opens OpenCode with the test project

This way your main OpenCode setup remains untouched.

### Manual Key Rotation Test

To test key rotation manually:

```bash
# Start with debug logging to see rotation
HOME=/tmp/test-home opencode /path/to/test-project --print-logs --log-level DEBUG

# Watch for logs showing:
# - [ollama-multi] Auth error detected, rotating key...
# - [ollama-multi] Rotated to Key #2
# - [ollama-multi] Updated auth.json with new key
```

## License

MIT License - see LICENSE file for details