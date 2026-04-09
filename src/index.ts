import { Plugin } from '@opencode-ai/plugin'
import { loadKeyState, saveKeyState, markKeyFailed } from './state.js'

const PROVIDER_ID = 'ollama-multi'

interface OllamaMultiAuthConfig {
  keys?: string[]
  failWindowMs?: number
  maxRetries?: number
}

function getApiKeysFromConfig(config: OllamaMultiAuthConfig): string[] {
  const keys: string[] = []
  
  if (Array.isArray(config.keys)) {
    keys.push(...config.keys.filter((k): k is string => typeof k === 'string'))
  }
  
  return keys
}

function getApiKeysFromEnv(): string[] {
  const keys: string[] = []
  const seen = new Set<string>()

  const mainKey = process.env.OLLAMA_API_KEY
  if (mainKey && !seen.has(mainKey)) {
    seen.add(mainKey)
    keys.unshift(mainKey)
  }

  let i = 1
  while (true) {
    const envKey = `OLLAMA_API_KEY_${i}`
    const value = process.env[envKey]
    if (!value) break
    if (!seen.has(value)) {
      seen.add(value)
      keys.push(value)
    }
    i++
  }

  return keys
}

function deduplicateKeys(keys: string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(key)
    }
  }
  return unique
}

function isAuthError(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true
  const lower = bodyText.toLowerCase()
  return lower.includes('unauthorized') ||
    lower.includes('invalid') ||
    lower.includes('api key') ||
    lower.includes('authentication') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('usage limit') ||
    lower.includes('quota exceeded')
}

export const OllamaMultiAuth: Plugin = async (_, options) => {
  console.log('[ollama-multi] Plugin loading with options:', JSON.stringify(options))
  
  const config = (options?.ollamaMultiAuth as OllamaMultiAuthConfig) || {}
  console.log('[ollama-multi] Config extracted:', JSON.stringify(config))
  const maxRetries = config.maxRetries || 5

  const configKeys = getApiKeysFromConfig(config)
  const envKeys = getApiKeysFromEnv()

  const allKeys = [...configKeys, ...envKeys]
  const uniqueKeys = deduplicateKeys(allKeys)
  
  console.log('[ollama-multi] Keys loaded:', uniqueKeys.length)

  if (uniqueKeys.length === 0) {
    console.warn('[ollama-multi] No API keys configured')
    return {}
  }

  let keyState = loadKeyState(uniqueKeys)
  let currentKeyIndex = 0

  function getAvailableKeys(): { key: string; index: number }[] {
    const failWindow = config.failWindowMs || 18000000
    return keyState.keys
      .map((k, i) => ({ key: k.key, index: i }))
      .filter(k => {
        const state = keyState.keys[k.index]
        return !state.failedAt || Date.now() - state.failedAt > failWindow
      })
  }

  function getNextAvailableKey(): { key: string; index: number } | null {
    const available = getAvailableKeys()
    if (available.length === 0) {
      return null
    }
    return available[0]
  }

  function getCurrentKey(): string {
    const available = getNextAvailableKey()
    if (available) {
      currentKeyIndex = available.index
      return available.key
    }
    currentKeyIndex = 0
    return keyState.keys[0]?.key || ''
  }

  function markCurrentKeyFailed() {
    markKeyFailed(keyState, currentKeyIndex)
    saveKeyState(keyState)
    keyState = loadKeyState(uniqueKeys)
  }

  async function fetchWithKeyRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    retryCount = 0
  ): Promise<Response> {
    const apiKey = getCurrentKey()

    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${apiKey}`)

    const response = await fetch(input, {
      ...init,
      headers
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      
      if (isAuthError(response.status, bodyText) && retryCount < maxRetries) {
        markCurrentKeyFailed()
        
        const nextAvailable = getNextAvailableKey()
        if (nextAvailable) {
          return fetchWithKeyRetry(input, init, retryCount + 1)
        }
      }
    }

    return response
  }

  return {
    auth: {
      provider: PROVIDER_ID,
      loader: async () => {
        const apiKey = getCurrentKey()
        console.log('[ollama-multi] auth.loader called, returning key:', apiKey.substring(0, 20) + '...')
        
        return {
          apiKey,
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            return fetchWithKeyRetry(input, init)
          }
        }
      },
      methods: [
        {
          type: 'api' as const,
          label: 'Ollama Multi-Key API',
        },
      ],
    },
  }
}

export default OllamaMultiAuth