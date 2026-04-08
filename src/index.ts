import { Plugin } from '@opencode-ai/plugin'
import { loadKeyState, saveKeyState, markKeyFailed, getWorkingKey } from './state.js'

interface OllamaMultiAuthConfig {
  keys?: string[]
  failWindowMs?: number
  cloudUrl?: string
}

function getApiKeysFromEnv(): string[] {
  const keys: string[] = []
  let i = 1
  while (true) {
    const envKey = `OLLAMA_API_KEY_${i}`
    const value = process.env[envKey]
    if (!value) break
    keys.push(value)
    i++
  }
  const mainKey = process.env.OLLAMA_API_KEY
  if (mainKey && !keys.includes(mainKey)) {
    keys.unshift(mainKey)
  }
  return keys
}

function extractApiKeys(options: Record<string, unknown>): string[] {
  const keys: string[] = []
  
  if (Array.isArray(options.keys)) {
    keys.push(...options.keys.filter((k): k is string => typeof k === 'string'))
  }
  
  if (options.key) {
    const key = options.key
    if (typeof key === 'string') {
      keys.push(key)
    }
  }
  
  return keys
}

export const OllamaMultiAuth: Plugin = async (_, options) => {
  const config = (options?.ollamaMultiAuth as OllamaMultiAuthConfig) || {}
  const apiKeys = [
    ...extractApiKeys(options as Record<string, unknown>),
    ...getApiKeysFromEnv()
  ]
  
  const uniqueKeys: string[] = []
  const seen = new Set<string>()
  for (const key of apiKeys) {
    if (!seen.has(key)) {
      seen.add(key)
      uniqueKeys.push(key)
    }
  }
  
  if (uniqueKeys.length === 0) {
    console.warn('[ollama-multi-auth] No API keys configured')
    return {}
  }
  
  let keyState = loadKeyState(uniqueKeys)
  let currentKeyIndex = 0
  
  const workingKey = getWorkingKey(keyState)
  if (workingKey) {
    currentKeyIndex = keyState.keys.findIndex(k => k.key === workingKey)
  }

  return {
    auth: {
      provider: 'ollama',
      loader: async () => {
        const failWindow = config.failWindowMs || 18000000
        const available = keyState.keys.filter(k => !k.failedAt || Date.now() - k.failedAt > failWindow)
        
        if (available.length === 0) {
          console.warn('[ollama-multi-auth] All keys failed recently, using first key')
          return { apiKey: keyState.keys[0]?.key || '' }
        }
        
        const nextKey = available[0].key
        currentKeyIndex = keyState.keys.findIndex(k => k.key === nextKey)
        
        console.log(`[ollama-multi-auth] Using key ${currentKeyIndex + 1}/${keyState.keys.length}`)
        
        return { apiKey: nextKey }
      },
      methods: [
        {
          type: 'api' as const,
          label: 'Ollama Cloud API Key (Multi-Auth)',
        },
      ],
    },
    
    'tool.execute.after': async ({ tool }, { output }) => {
      if (tool !== 'ollama' && tool !== 'ollama_chat' && tool !== 'ollama_generate') {
        return
      }
      
      const outputStr = typeof output === 'string' ? output : JSON.stringify(output)
      
      const isAuthError = 
        outputStr.includes('401') ||
        outputStr.includes('403') ||
        outputStr.includes('authentication') ||
        outputStr.includes('api key') ||
        outputStr.includes('invalid') ||
        outputStr.includes('unauthorized') ||
        outputStr.includes('429') ||
        outputStr.includes('rate limit')
      
      if (isAuthError) {
        console.log(`[ollama-multi-auth] Key ${currentKeyIndex + 1} failed, marking as failed`)
        markKeyFailed(keyState, currentKeyIndex)
        
        keyState = loadKeyState(uniqueKeys)
        const newWorkingKey = getWorkingKey(keyState)
        if (newWorkingKey) {
          currentKeyIndex = keyState.keys.findIndex(k => k.key === newWorkingKey)
        }
      }
    },
  }
}

export default OllamaMultiAuth