# opencode-ollama-multi-auth

Opencode plugin for managing multiple Ollama Cloud API keys with automatic failover.

## Features

- **Multiple API Keys** - Add any number of API keys
- **Automatic Failover** - Automatically switch to next key when current one fails
- **Key Recovery** - Re-enable failed keys after 5 hours
- **Dual Configuration** - Support both opencode.json and environment variables

## Installation

```bash
cd opencode-ollama-multi-auth
bun install
bun run build
bun link
```

## Configuration

### Option 1: opencode.json

Add to your project's `opencode.json`:

```json
{
  "plugin": [
    ["opencode-ollama-multi-auth", {
      "ollamaMultiAuth": {
        "keys": ["sk-key1", "sk-key2", "sk-key3"],
        "failWindowMs": 18000000
      }
    }]
  ]
}
```

### Option 2: Environment Variables

```bash
export OLLAMA_API_KEY_1=sk-xxx
export OLLAMA_API_KEY_2=sk-yyy
export OLLAMA_API_KEY_3=sk-zzz
# Add more with OLLAMA_API_KEY_4, etc.
```

## Usage

Once configured, the plugin automatically:
1. Loads all configured API keys
2. Selects the first available (non-failed) key for each request
3. Monitors for authentication errors (401, 403, 429, rate limits)
4. Marks failed keys and rotates to next available key
5. Re-enables keys after 5 hours

## State File

Key failure state is stored in `~/.opencode/ollama-keys-state.json`

## Troubleshooting

Run opencode with verbose logging to see key selection:
```bash
opencode --verbose
```

## Notes

- The plugin hooks into the `ollama` auth provider
- It only monitors for tool executions named `ollama`, `ollama_chat`, or `ollama_generate`
- If all keys fail, it falls back to the first key with a warning