# opencode-ollama-multi-auth

Opencode plugin for managing multiple Ollama Cloud API keys with automatic failover.

## Features

- **Multiple API Keys** - Add any number of API keys
- **Automatic Failover** - Automatically switch to next key when current one fails (401, 403, 429)
- **Key Recovery** - Re-enable failed keys after 5 hours (configurable)
- **Multi-Source Keys** - Load from opencode.json, environment variables, or existing auth.json
- **Fetch Wrapper** - Intercepts requests and retries with next key on auth errors

## Installation

### Option 1: npm (recommended)

```bash
npm install -g opencode-ollama-multi-auth
```

Then add to your opencode.json:

```json
{
  "plugin": [
    "opencode-ollama-multi-auth"
  ]
}
```

### Option 2: Local Development

```bash
cd opencode-ollama-multi-auth
npm install
npm run build
```

Add to your opencode.json with file path:

```json
{
  "plugin": [
    ["file:///path/to/opencode-ollama-multi-auth", {
      "ollamaMultiAuth": {
        "keys": ["your-api-keys"]
      }
    }]
  ]
}
```

## Configuration

### Keys Source Priority

1. **opencode.json** (highest priority)
2. **Environment variables**
3. **Existing auth.json** (fallback - if you've run `/connect` before)

### Option 1: opencode.json

Add to your project's `opencode.json` or global `~/.config/opencode/opencode.json`:

```json
{
  "model": "ollama/gemma4:31b-cloud",
  "provider": {
    "ollama-cloud": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://ollama.com/v1"
      }
    }
  },
  "plugin": [
    ["opencode-ollama-multi-auth", {
      "ollamaMultiAuth": {
        "keys": [
          "your-ollama-cloud-key-1",
          "your-ollama-cloud-key-2",
          "your-ollama-cloud-key-3"
        ],
        "failWindowMs": 18000000
      }
    }]
  ]
}
```

### Option 2: Environment Variables

```bash
export OLLAMA_API_KEY="your-first-key"
export OLLAMA_API_KEY_1="your-second-key"
export OLLAMA_API_KEY_2="your-third-key"
# Add more with OLLAMA_API_KEY_3, etc.
```

### Option 3: Existing Credentials

If you've previously run `/connect` and added Ollama Cloud credentials, those are automatically included as fallback keys.

## How It Works

1. **On Load**: Plugin loads all keys from config + env + existing auth, deduplicates them
2. **On Request**: Selects first available (non-failed) key
3. **On Auth Error** (401/403/429): 
   - Marks current key as failed
   - Rotates to next available key
   - Retries request immediately
4. **Key Recovery**: Failed keys are re-enabled after 5 hours (or `failWindowMs`)

## Provider Configuration

The plugin works with the `ollama-cloud` provider:

```json
"provider": {
  "ollama-cloud": {
    "npm": "@ai-sdk/openai-compatible",
    "options": {
      "baseURL": "https://ollama.com/v1"
    }
  }
}
```

## State File

Key failure state is stored in `~/.opencode/ollama-keys-state.json`

## Troubleshooting

Run opencode with verbose logging to see key selection:

```bash
opencode --print-logs --log-level DEBUG
```

Look for logs:
- `[ollama-multi-auth] Loaded X API keys`
- `[ollama-multi-auth] Using key X/Y`

## Notes

- The plugin hooks into the `ollama-cloud` auth provider
- If all keys fail, it falls back to the first key with a warning
- API keys are never logged, only truncated for display