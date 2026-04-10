import { Plugin } from '@opencode-ai/plugin'
import { loadKeyState, saveKeyState, markKeyFailed, getWorkingKey } from './state.js'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEFAULT_PROVIDER_ID = 'ollama-multi'
const AUTH_JSON_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json')

interface OllamaMultiAuthConfig {
  keys?: string[]
  failWindowMs?: number
  providerId?: string
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

async function updateOllamaMultiKey(key: string, targetProviderId: string): Promise<void> {
  const auth = await readAuthJson()
  auth[targetProviderId] = {
    type: 'api',
    key: key
  }
  await writeAuthJson(auth)
}

function getApiKeysFromConfig(config: OllamaMultiAuthConfig): string[] {
  if (Array.isArray(config.keys)) {
    return config.keys.filter((k): k is string => typeof k === 'string')
  }
  return []
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
  const providerId = config.providerId || DEFAULT_PROVIDER_ID

  const configKeys = getApiKeysFromConfig(config)
  const envKeys = getApiKeysFromEnv()
  const allKeys = [...configKeys, ...envKeys]
  const uniqueKeys = deduplicateKeys(allKeys)

  if (uniqueKeys.length === 0) {
    console.warn(`[${providerId}] No API keys configured`)
    return {}
  }

  console.log(`[${providerId}] Loaded ${uniqueKeys.length} keys`)

  let keyState = loadKeyState(uniqueKeys)

  const firstKey = getWorkingKey(keyState) || uniqueKeys[0]
  if (firstKey) {
    await updateOllamaMultiKey(firstKey, providerId)
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

  function getCurrentKeyFromState(): string {
    const available = getAvailableKeys()
    if (available.length > 0) {
      return available[0].key
    }
    return keyState.keys[0]?.key || ''
  }

  let rotating = false

  async function rotateToNextKey(failedKey: string): Promise<void> {
    if (rotating) return
    rotating = true
    
    try {
      console.log(`[${providerId}] Rotating from failed key...`)
      
      keyState = loadKeyState(uniqueKeys)
      
      const failedIndex = keyState.keys.findIndex(k => k.key === failedKey)
      if (failedIndex !== -1) {
        markKeyFailed(keyState, failedIndex)
        saveKeyState(keyState)
        keyState = loadKeyState(uniqueKeys)
      }
      
      const available = getAvailableKeys()
      if (available.length > 0) {
        const nextKey = available[0].key
        await updateOllamaMultiKey(nextKey, providerId)
        console.log(`[${providerId}] Rotated to next key`)
      } else {
        console.warn('[ollama-multi] No available keys')
      }
    } finally {
      rotating = false
    }
  }

  return {
    auth: {
      provider: providerId,
      loader: async () => {
        const currentKey = getCurrentKeyFromState()
        console.log(`[${providerId}] loader key:`, currentKey.substring(0, 15) + '...')
        
        return {
          apiKey: '',
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            const authData = await readAuthJson()
            const currentKey = authData[providerId]?.key || getCurrentKeyFromState()
            
            const headers = new Headers(init?.headers)
            headers.delete('authorization')
            headers.delete('Authorization')
            headers.set('Authorization', `Bearer ${currentKey}`)
            
            const response = await fetch(input, {
              ...init,
              headers
            })
            
            if (isAuthErrorByStatus(response.status)) {
              console.log(`[${providerId}] Error ${response.status}, rotating...`)
              await rotateToNextKey(currentKey)
            }
            
            return response
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