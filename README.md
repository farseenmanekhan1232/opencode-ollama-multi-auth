# opencode-ollama-multi-auth

[![npm version](https://img.shields.io/npm/v/opencode-ollama-multi-auth)](https://www.npmjs.com/package/opencode-ollama-multi-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Opencode plugin for Ollama Cloud with multiple API keys and automatic failover.

## Features

- **Multiple API Keys** - Add unlimited API keys for Ollama Cloud
- **Automatic Failover** - Automatically switch to next key when current one fails (401, 403, 429)
- **Key Recovery** - Re-enable failed keys after 5 hours (configurable)
- **Built-in Provider** - Uses the `ollama-multi` provider with pre-configured models
- **Fetch Interceptor** - Intercepts requests and retries with next key on auth errors

## Installation

```bash
npm install -g opencode-ollama-multi-auth
```

## Quick Start

1. **Install the plugin**:
   ```bash
   npm install -g opencode-ollama-multi-auth
   ```

2. **Configure your opencode.json**:

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
             "your-ollama-key-1",
             "your-ollama-key-2",
             "your-ollama-key-3"
           ]
         }
       }]
     ]
   }
   ```

3. **Run opencode**:
   ```bash
   opencode
   ```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | string[] | [] | Array of API keys to use |
| `failWindowMs` | number | 18000000 | Time in ms before retrying a failed key (default: 5 hours) |
| `maxRetries` | number | 5 | Maximum number of key rotations per request |

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

## Environment Variables

You can also provide keys via environment variables:

```bash
export OLLAMA_API_KEY="your-first-key"
export OLLAMA_API_KEY_1="your-second-key"
export OLLAMA_API_KEY_2="your-third-key"
```

## How It Works

1. **On Load**: Plugin loads all keys from config + env, deduplicates them
2. **On Request**: Selects first available (non-failed) key
3. **On Auth Error** (401/403/429): 
   - Marks current key as failed
   - Rotates to next available key
   - Retries request immediately
4. **Key Recovery**: Failed keys are re-enabled after 5 hours (or `failWindowMs`)

## Available Models

The plugin works with Ollama Cloud models. Some popular ones:
- `ollama-multi/kimi-k2.5`
- `ollama-multi/qwen3.5:397b`
- `ollama-multi/gemma4:31b-cloud`

Add any Ollama Cloud model to your provider config to use it.

## State File

Key failure state is stored in `~/.opencode/ollama-keys-state.json`

## License

MIT License - see LICENSE file for details