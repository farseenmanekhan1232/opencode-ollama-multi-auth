# opencode-ollama-multi-auth

[![npm version](https://img.shields.io/npm/v/opencode-ollama-multi-auth)](https://www.npmjs.com/package/opencode-ollama-multi-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Opencode plugin for Ollama Cloud with multiple API keys and automatic failover.

## Features

- **Multiple API Keys** - Add unlimited API keys for Ollama Cloud
- **Automatic Failover** - Automatically switch to next key when current one fails (401, 403, 429)
- **Key Recovery** - Re-enable failed keys after 5 hours (configurable)
- **Built-in Provider** - Uses the `ollama-multi` provider with pre-configured models
- **Auto-Setup** - Plugin automatically manages auth.json for you

## Installation

```bash
npm install -g opencode-ollama-multi-auth
```

## Quick Start

### Step 1: Install the plugin

```bash
npm install -g opencode-ollama-multi-auth
```

### Step 2: Configure opencode.json

Add to `~/.config/opencode/opencode.json` (global) or your project:

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
          "your-ollama-api-key-2",
          "your-ollama-api-key-3"
        ]
      }
    }]
  ]
}
```

### Step 3: Run OpenCode

```bash
opencode
```

The plugin will automatically:
- Set up auth.json with your first API key
- Monitor for auth failures
- Rotate to the next key when one fails
- Re-enable failed keys after the recovery window

## How It Works

This plugin uses OpenCode's built-in auth system with automatic key management:

1. **Plugin Initialization**: On startup, the plugin writes the first key to `~/.local/share/opencode/auth.json`
2. **Normal Operation**: OpenCode uses the current key from auth.json for all requests
3. **Failure Detection**: When a key fails (401/403/429), the plugin detects it via the `tool.execute.after` hook
4. **Automatic Rotation**: The plugin updates auth.json with the next available key
5. **Key Recovery**: Failed keys are automatically re-enabled after the configured window (default: 5 hours)

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | string[] | [] | Array of API keys to use for rotation |
| `failWindowMs` | number | 18000000 | Time in ms before retrying a failed key (default: 5 hours) |
| `maxRetries` | number | 5 | Maximum number of key rotations per request |

## Adding Multiple Keys

### Option 1: Plugin Configuration (Recommended)

Add keys to your `opencode.json` plugin configuration:

```json
"plugin": [
  ["opencode-ollama-multi-auth", {
    "ollamaMultiAuth": {
      "keys": [
        "key-1",
        "key-2", 
        "key-3",
        "key-4",
        "key-5"
      ]
    }
  }]
]
```

### Option 2: Environment Variables

Set keys in your shell profile:

```bash
export OLLAMA_API_KEY="your-first-key"
export OLLAMA_API_KEY_1="your-second-key"
export OLLAMA_API_KEY_2="your-third-key"
```

You can combine both methods - the plugin will merge keys from both sources.

## Adding Models

The `ollama-multi` provider requires models to be explicitly defined. Add models under `provider.ollama-multi.models`:

```json
"models": {
  "model-id": {
    "id": "model-id",
    "name": "Display Name",
    "family": "model-family"
  }
}
```

## Available Models

The plugin works with Ollama Cloud models. Some popular ones:
- `ollama-multi/kimi-k2.5`
- `ollama-multi/qwen3.5:397b`
- `ollama-multi/gemma4:31b-cloud`

Add any Ollama Cloud model to your provider config to use it.

## State File

Key failure state is stored in `~/.opencode/ollama-keys-state.json`

## Troubleshooting

### "Unauthorized" Error

If you get an "Unauthorized" error:

1. **Check your keys**: Verify they work with curl:
   ```bash
   curl -H "Authorization: Bearer YOUR_KEY" https://ollama.com/v1/models
   ```
2. **Check auth.json**: The plugin should auto-create this at `~/.local/share/opencode/auth.json`
3. **Restart OpenCode**: After fixing configuration

### Keys Not Rotating

If keys aren't rotating:

1. Verify the plugin is loaded: check for `[ollama-multi]` logs in OpenCode's output
2. Check the state file: `~/.opencode/ollama-keys-state.json`
3. Ensure you have multiple keys configured

## License

MIT License - see LICENSE file for details