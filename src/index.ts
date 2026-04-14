import { Plugin } from '@opencode-ai/plugin'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEFAULT_PROVIDER_ID = 'ollama-multi'
const AUTH_JSON_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json')

interface OllamaMultiAuthConfig {
  keys?: string[]
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

  if (uniqueKeys[0]) {
    await updateOllamaMultiKey(uniqueKeys[0], providerId)
  }

  let failedKeys = new Set<string>()
  let currentKeyIndex = 0

  function getCurrentKey(): string {
    while (currentKeyIndex < uniqueKeys.length) {
      if (!failedKeys.has(uniqueKeys[currentKeyIndex])) {
        return uniqueKeys[currentKeyIndex]
      }
      currentKeyIndex++
    }
    return uniqueKeys[0] || ''
  }

  async function rotateToNextKey(failedKey: string): Promise<void> {
    const failedIndex = uniqueKeys.indexOf(failedKey)
    if (failedIndex !== -1) {
      failedKeys.add(failedKey)
    }
    
    currentKeyIndex = failedIndex + 1
    while (currentKeyIndex < uniqueKeys.length) {
      if (!failedKeys.has(uniqueKeys[currentKeyIndex])) {
        await updateOllamaMultiKey(uniqueKeys[currentKeyIndex], providerId)
        return
      }
      currentKeyIndex++
    }
    
    currentKeyIndex = 0
    while (currentKeyIndex < uniqueKeys.length) {
      if (!failedKeys.has(uniqueKeys[currentKeyIndex])) {
        await updateOllamaMultiKey(uniqueKeys[currentKeyIndex], providerId)
        return
      }
      currentKeyIndex++
    }
  }

  return {
    auth: {
      provider: providerId,
      loader: async () => {
        return {
          apiKey: '',
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            let attempt = 0
            
            while (attempt < uniqueKeys.length) {
              const currentKey = getCurrentKey()
              
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
            
            throw new Error(`[${providerId}] ALL API KEYS EXHAUSTED! All ${uniqueKeys.length} keys have failed. Please add fresh keys.`)
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