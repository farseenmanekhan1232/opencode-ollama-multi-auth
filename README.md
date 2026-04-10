# opencode-ollama-multi-auth

[![npm version](https://img.shields.io/npm/v/opencode-ollama-multi-auth)](https://www.npmjs.com/package/opencode-ollama-multi-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

OpenCode plugin for Ollama Cloud with multiple API keys and automatic failover. Never run out of API quota!

## Features

- **Multiple API Keys** - Add unlimited API keys from different Ollama Cloud accounts
- **Automatic Failover** - Automatically rotates to next key when current one fails (401, 403, 429)
- **Auto Recovery** - Re-enables failed keys after 5 hours (configurable)
- **Concurrency Safe** - Handles multiple concurrent requests without state corruption

## Installation

```bash
npm install -g opencode-ollama-multi-auth
```

## Configuration

Add the plugin to your `~/.config/opencode/opencode.json`:

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
        "gemma4:31b-cloud": { "id": "gemma4:31b-cloud", "name": "Gemma 4 31B", "family": "gemma" }
      }
    }
  },
  "plugin": [
    ["opencode-ollama-multi-auth", {
      "ollamaMultiAuth": {
        "keys": [
          "your-ollama-api-key-1",
          "your-ollama-api-key-2",
          "your-ollama-api-key-3"
        ],
        "failWindowMs": 18000000,
        "maxRetries": 5
      }
    }]
  ]
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | string[] | [] | Array of API keys to rotate through |
| `failWindowMs` | number | 18000000 | Time in ms before retrying a failed key (default: 5 hours) |
| `maxRetries` | number | 5 | Maximum key rotations per request |
| `providerId` | string | "ollama-multi" | Provider ID to manage (for custom providers) |

## Environment Variables

You can also set keys via environment variables:

```bash
export OLLAMA_API_KEY="your-first-key"
export OLLAMA_API_KEY_1="your-second-key"
export OLLAMA_API_KEY_2="your-third-key"
```

Keys from environment variables are merged with config keys.

## How It Works

```
Request 1: Using Key #1 ✅ Success
Request 2: Using Key #1 ❌ Rate limited (429)
           ↓ Automatic rotation
Request 2: Using Key #2 ✅ Success
...
```

The plugin intercepts API requests and:
1. Uses the first available key from your list
2. Detects auth errors (401, 403, 429)
3. Marks failed key and rotates to next available key
4. Re-enables failed keys after the fail window expires

## State Files

The plugin manages these files automatically:
- `~/.local/share/opencode/auth.json` - Current active key
- `~/.opencode/ollama-keys-state.json` - Key failure history

## Testing

The plugin includes a mock server for testing key rotation:

```bash
cd node_modules/opencode-ollama-multi-auth
node scripts/mock-server.js
```

Then configure a test provider in opencode.json pointing to `http://127.0.0.1:11435/v1` with test keys.

## Available Models

Pre-configured Ollama Cloud models:
- `ollama-multi/kimi-k2.5` - Moonshot Kimi K2.5
- `ollama-multi/qwen3.5:397b` - Alibaba Qwen 3.5 397B
- `ollama-multi/gemma4:31b-cloud` - Google Gemma 4 31B

## License

MIT License