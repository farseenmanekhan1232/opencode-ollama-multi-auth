import { Plugin } from '@opencode-ai/plugin'
import { loadKeyState, saveKeyState, markKeyFailed, getWorkingKey } from './state.js'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

interface OllamaMultiAuthConfig {
  keys?: string[]
  failWindowMs?: number
}

async function readExistingOllamaCloudKey(): Promise<string | null> {
  try {
    const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
    const content = await readFile(authPath, 'utf-8')
    const auth = JSON.parse(content) as Record<string, { key?: string }>
    return auth['ollama-cloud']?.key || null
  } catch {
    return null
  }
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

function extractApiKeysFromConfig(config: OllamaMultiAuthConfig): string[] {
  const keys: string[] = []
  
  if (Array.isArray(config.keys)) {
    keys.push(...config.keys.filter((k): k is string => typeof k === 'string'))
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

export const OllamaMultiAuth: Plugin = async (_, options) => {
  const config = (options?.ollamaMultiAuth as OllamaMultiAuthConfig) || {}
  
  console.log('[ollama-multi-auth] Raw options:', JSON.stringify(options))
  
  const configKeys = extractApiKeysFromConfig(config)
  const envKeys = getApiKeysFromEnv()
  const existingKey = await readExistingOllamaCloudKey()

  const allKeys = [
    ...configKeys,
    ...envKeys,
    ...(existingKey ? [existingKey] : [])
  ]

  const uniqueKeys = deduplicateKeys(allKeys)

  if (uniqueKeys.length === 0) {
    console.warn('[ollama-multi-auth] No API keys configured')
    return {}
  }

  console.log(`[ollama-multi-auth] Loaded ${uniqueKeys.length} API keys (config: ${configKeys.length}, env: ${envKeys.length}, existing: ${existingKey ? 1 : 0})`)
  console.log('[ollama-multi-auth] Keys:', uniqueKeys.map(k => k.substring(0, 20) + '...').join(', '))

  let keyState = loadKeyState(uniqueKeys)

  function getAvailableKeys(): { key: string; index: number }[] {
    const failWindow = config.failWindowMs || 18000000
    return keyState.keys
      .map((k, i) => ({ key: k.key, index: i }))
      .filter(k => {
        const state = keyState.keys[k.index]
        return !state.failedAt || Date.now() - state.failedAt > failWindow
      })
  }

  let currentKeyIndex = 0

  function getNextApiKey(): string {
    const available = getAvailableKeys()
    
    if (available.length === 0) {
      console.warn('[ollama-multi-auth] All keys failed recently, using first key')
      currentKeyIndex = 0
      return keyState.keys[0]?.key || ''
    }

    const nextKey = available[0]
    currentKeyIndex = nextKey.index
    
    console.log(`[ollama-multi-auth] Using key ${currentKeyIndex + 1}/${keyState.keys.length} (${keyState.keys[currentKeyIndex].key.substring(0, 20)}...)`)
    
    return nextKey.key
  }

  function isOllamaProvider(providerId?: string): boolean {
    if (!providerId) return false
    const lower = providerId.toLowerCase()
    return lower === 'ollama' || lower === 'ollama-cloud' || lower.includes('ollama')
  }

  function isAuthError(output: string): boolean {
    const lower = output.toLowerCase()
    return lower.includes('401') ||
      lower.includes('403') ||
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('too many requests') ||
      lower.includes('usage limit') ||
      lower.includes('session limit') ||
      lower.includes('quota exceeded') ||
      lower.includes('authentication') ||
      lower.includes('api key') ||
      lower.includes('invalid') ||
      lower.includes('unauthorized')
  }

  return {
    auth: {
      provider: 'ollama-cloud',
      loader: async (getAuth) => {
        console.log('[ollama-multi-auth] auth.loader called')
        const apiKey = getNextApiKey()
        console.log('[ollama-multi-auth] auth.loader returning key:', apiKey.substring(0, 20) + '...')
        return { apiKey }
      },
      methods: [
        {
          type: 'api' as const,
          label: 'Ollama Cloud API Key (Multi-Auth)',
        },
      ],
    },
    
    'chat.params': async (
      { provider },
      { options }
    ) => {
      const providerId = provider?.info?.id
      console.log('[ollama-multi-auth] chat.params called, providerId:', providerId, 'options.apiKey before:', options.apiKey ? 'set' : 'not set')
      
      if (isOllamaProvider(providerId)) {
        const apiKey = getNextApiKey()
        options.apiKey = apiKey
        console.log('[ollama-multi-auth] chat.params set apiKey:', apiKey.substring(0, 20) + '...')
      } else {
        console.log('[ollama-multi-auth] chat.params - not ollama provider, skipping')
      }
    },
    
    'tool.execute.after': async ({ tool, sessionID }, { title, output, metadata }) => {
      const outputStr = typeof output === 'string' ? output : JSON.stringify(output)
      console.log('[ollama-multi-auth] tool.execute.after called, tool:', tool, 'output preview:', outputStr.substring(0, 100))
      
      if (isAuthError(outputStr)) {
        console.log('[ollama-multi-auth] Key ' + (currentKeyIndex + 1) + ' marked as failed')
        console.log('[ollama-multi-auth] Tool: ' + tool)
        
        markKeyFailed(keyState, currentKeyIndex)
        saveKeyState(keyState)
        
        keyState = loadKeyState(uniqueKeys)
        const newWorkingKey = getWorkingKey(keyState)
        if (newWorkingKey) {
          currentKeyIndex = keyState.keys.findIndex(k => k.key === newWorkingKey)
          console.log('[ollama-multi-auth] Rotated to key index:', currentKeyIndex)
        }
      }
    },
  }
}

export default OllamaMultiAuth