# opencode-ollama-multi-auth

[![npm version](https://img.shields.io/npm/v/opencode-ollama-multi-auth)](https://www.npmjs.com/package/opencode-ollama-multi-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Opencode plugin for managing multiple Ollama Cloud API keys with automatic failover.

## Features

- **Multiple API Keys** - Add any number of API keys
- **Automatic Failover** - Automatically switch to next key when current one fails (401, 403, 429)
- **Key Recovery** - Re-enable failed keys after 5 hours (configurable)
- **Multi-Source Keys** - Load from opencode.json, environment variables, or existing auth.json
- **Fetch Wrapper** - Intercepts requests and retries with next key on auth errors
- **Seamless Integration** - Works with existing Ollama Cloud setups

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
git clone https://github.com/farseenmanekhan1232/opencode-ollama-multi-auth.git
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

## Quick Start

1. **Install the plugin**:
   ```bash
   npm install -g opencode-ollama-multi-auth
   ```

2. **Configure your opencode.json**:
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
       "opencode-ollama-multi-auth"
     ]
   }
   ```

3. **Add your API keys** (see Configuration options below)

4. **Run opencode**:
   ```bash
   opencode
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

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export OLLAMA_API_KEY="your-first-key"
export OLLAMA_API_KEY_1="your-second-key"
export OLLAMA_API_KEY_2="your-third-key"
# Add more with OLLAMA_API_KEY_3, etc.
```

Then restart terminal or run `source ~/.zshrc`

### Option 3: Existing Credentials

If you've previously run `/connect` and added Ollama Cloud credentials, those are automatically included as fallback keys. This ensures backward compatibility with existing setups.

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | string[] | [] | Array of API keys to use |
| `failWindowMs` | number | 18000000 | Time in ms before retrying a failed key (default: 5 hours) |

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
- `[ollama-multi-auth] Key X failed with 401, rotating...`

## Notes

- The plugin hooks into the `ollama-cloud` auth provider
- If all keys fail, it falls back to the first key with a warning
- API keys are never logged in full, only truncated for display
- Works with any Ollama Cloud model (e.g., `ollama/gemma4:31b-cloud`)

## License

MIT License - see LICENSE file for details

## Related

- [opencode-ollama-multi-auth on npm](https://www.npmjs.com/package/opencode-ollama-multi-auth)
- [OpenCode Documentation](https://docs.opencode.ai)
- [Ollama Cloud Documentation](https://docs.ollama.com/cloud)