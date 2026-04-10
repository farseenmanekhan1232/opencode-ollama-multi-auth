import { Plugin } from '@opencode-ai/plugin'
import { loadKeyState, saveKeyState, markKeyFailed, getWorkingKey } from './state.js'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const PROVIDER_ID = 'ollama-multi'
const AUTH_JSON_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json')

interface OllamaMultiAuthConfig {
  keys?: string[]
  failWindowMs?: number
  maxRetries?: number
}

async function readAuthJson(): Promise<Record<string, any>> {
  try {
    if (!existsSync(AUTH_JSON_PATH)) {
      return {}
    }
    const content = await readFile(AUTH_JSON_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeAuthJson(auth: Record<string, any>): Promise<void> {
  await writeFile(AUTH_JSON_PATH, JSON.stringify(auth, null, 2), 'utf-8')
}

async function updateOllamaMultiKey(key: string): Promise<void> {
  const auth = await readAuthJson()
  auth[PROVIDER_ID] = {
    type: 'api',
    key: key
  }
  await writeAuthJson(auth)
  console.log('[ollama-multi] Updated auth.json with new key:', key.substring(0, 20) + '...')
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

function isAuthErrorByStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429
}

export const OllamaMultiAuth: Plugin = async (_, options) => {
  console.log('[ollama-multi] Plugin loading...')
  
  const config = (options?.ollamaMultiAuth as OllamaMultiAuthConfig) || {}
  const maxRetries = config.maxRetries || 5

  const configKeys = getApiKeysFromConfig(config)
  const envKeys = getApiKeysFromEnv()

  const allKeys = [...configKeys, ...envKeys]
  const uniqueKeys = deduplicateKeys(allKeys)

  if (uniqueKeys.length === 0) {
    console.warn('[ollama-multi] No API keys configured')
    return {}
  }

  console.log(`[ollama-multi] Loaded ${uniqueKeys.length} API keys`)

  let keyState = loadKeyState(uniqueKeys)
  let currentKeyIndex = 0

  // Initialize auth.json with first key
  const firstKey = getWorkingKey(keyState) || uniqueKeys[0]
  if (firstKey) {
    await updateOllamaMultiKey(firstKey)
    console.log('[ollama-multi] Initialized auth.json with first key')
  }

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

  async function rotateToNextKey(): Promise<boolean> {
    console.log(`[ollama-multi] Rotating from key ${currentKeyIndex + 1}...`)
    
    markKeyFailed(keyState, currentKeyIndex)
    saveKeyState(keyState)
    keyState = loadKeyState(uniqueKeys)
    
    const nextKey = getWorkingKey(keyState)
    if (nextKey) {
      currentKeyIndex = keyState.keys.findIndex(k => k.key === nextKey)
      await updateOllamaMultiKey(nextKey)
      console.log(`[ollama-multi] Rotated to key ${currentKeyIndex + 1}:`, nextKey.substring(0, 20) + '...')
      return true
    }
    
    console.warn('[ollama-multi] No available keys left')
    return false
  }

  async function makeRequestWithRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    attempt = 0
  ): Promise<Response> {
    // Read current key from auth.json (ensures we use latest rotated key)
    const auth = await readAuthJson()
    const apiKey = auth[PROVIDER_ID]?.key || getCurrentKey()
    
    console.log(`[ollama-multi] Request attempt ${attempt + 1} with key:`, apiKey.substring(0, 20) + '...')
    
    // Prepare headers with authorization
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${apiKey}`)
    
    const response = await fetch(input, {
      ...init,
      headers
    })
    
    // Check for auth errors by HTTP status code
    if (isAuthErrorByStatus(response.status)) {
      console.log(`[ollama-multi] Auth error detected (status ${response.status}), rotating key...`)
      
      // Read current key from state (not cached)
      keyState = loadKeyState(uniqueKeys)
      
      // Ensure currentKeyIndex matches the key we just used before marking it failed
      currentKeyIndex = keyState.keys.findIndex(k => k.key === apiKey)
      if (currentKeyIndex === -1) currentKeyIndex = 0
      
      const rotated = await rotateToNextKey()
      
      if (rotated && attempt < maxRetries) {
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 500))
        return makeRequestWithRetry(input, init, attempt + 1)
      }
      
      console.warn(`[ollama-multi] Max retries (${maxRetries}) reached, returning error`)
      
      // Parse the error message from the response if possible to include in the thrown error
      let errorMsg = ''
      try {
        const body = await response.clone().json()
        errorMsg = body.error || body.message || 'Rate limit exceeded'
      } catch {
        errorMsg = await response.clone().text().catch(() => 'Rate limit exceeded')
      }
      
      // Throw a clear error so the user knows exactly what happened, and to stop SDK retries
      throw new Error(`[ollama-multi] ALL API KEYS EXHAUSTED! Cycled through keys but all returned auth/rate-limit errors. Please add fresh keys from new accounts. Last API error: ${errorMsg}`)
    }
    
    return response
  }

  return {
    auth: {
      provider: PROVIDER_ID,
      loader: async () => {
        const apiKey = getCurrentKey()
        console.log('[ollama-multi] auth.loader returning key:', apiKey.substring(0, 20) + '...')
        
        return {
          apiKey,
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            return makeRequestWithRetry(input, init)
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