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
  const config = (options?.ollamaMultiAuth as OllamaMultiAuthConfig) || {}
  const providerId = config.providerId || DEFAULT_PROVIDER_ID

  const configKeys = getApiKeysFromConfig(config)
  const envKeys = getApiKeysFromEnv()
  const allKeys = [...configKeys, ...envKeys]
  const uniqueKeys = deduplicateKeys(allKeys)

  if (uniqueKeys.length === 0) {
    return {}
  }

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

  let rotationLock: Promise<void> | null = null

  async function rotateToNextKey(failedKey: string): Promise<void> {
    if (rotationLock) {
      await rotationLock
      return
    }
    
    rotationLock = (async () => {
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
      }
    })()

    try {
      await rotationLock
    } finally {
      rotationLock = null
    }
  }

  return {
    auth: {
      provider: providerId,
      loader: async () => {
        const currentKey = getCurrentKeyFromState()
        
        return {
          apiKey: '',
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            let attempt = 0
            const maxAttempts = uniqueKeys.length
            
            while (attempt < maxAttempts) {
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
                await rotateToNextKey(currentKey)
                attempt++
                continue
              }
              
              return response
            }
            
            throw new Error(`[${providerId}] ALL API KEYS EXHAUSTED! Cycled through ${maxAttempts} keys but all returned rate-limit or auth errors. Please add fresh keys.`)
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