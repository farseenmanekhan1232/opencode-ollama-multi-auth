import { Plugin } from '@opencode-ai/plugin'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEFAULT_PROVIDER_ID = 'ollama-multi'
const AUTH_JSON_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const PLUGIN_CONFIG_DIR = join(homedir(), '.config', 'opencode')
const PLUGIN_CONFIG_JSON_PATH = join(PLUGIN_CONFIG_DIR, 'ollama-multi-auth.json')
const PLUGIN_CONFIG_JSONC_PATH = join(PLUGIN_CONFIG_DIR, 'ollama-multi-auth.jsonc')

interface OllamaMultiAuthConfig {
  keys?: string[]
  providerId?: string
}

function stripJsonComments(input: string): string {
  let output = ''
  let i = 0
  let inString = false
  let inLineComment = false
  let inBlockComment = false

  while (i < input.length) {
    const current = input[i]
    const next = input[i + 1]

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false
        output += current
      }
      i++
      continue
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      i++
      continue
    }

    if (!inString && current === '/' && next === '/') {
      inLineComment = true
      i += 2
      continue
    }

    if (!inString && current === '/' && next === '*') {
      inBlockComment = true
      i += 2
      continue
    }

    if (current === '"' && input[i - 1] !== '\\') {
      inString = !inString
    }

    output += current
    i++
  }

  return output
}

function parseJsonOrJsonc(content: string): OllamaMultiAuthConfig {
  const withoutComments = stripJsonComments(content)
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(withoutTrailingCommas)
}

async function ensurePluginConfigExists(): Promise<void> {
  if (existsSync(PLUGIN_CONFIG_JSON_PATH) || existsSync(PLUGIN_CONFIG_JSONC_PATH)) {
    return
  }

  await mkdir(PLUGIN_CONFIG_DIR, { recursive: true })
  const initialConfig: OllamaMultiAuthConfig = {
    providerId: DEFAULT_PROVIDER_ID,
    keys: [],
  }
  await writeFile(PLUGIN_CONFIG_JSON_PATH, JSON.stringify(initialConfig, null, 2), 'utf-8')
}

async function readPluginConfig(): Promise<OllamaMultiAuthConfig> {
  const path = existsSync(PLUGIN_CONFIG_JSONC_PATH)
    ? PLUGIN_CONFIG_JSONC_PATH
    : PLUGIN_CONFIG_JSON_PATH

  if (!existsSync(path)) {
    return {}
  }

  try {
    const content = await readFile(path, 'utf-8')
    return parseJsonOrJsonc(content)
  } catch {
    return {}
  }
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

export const OllamaMultiAuth: Plugin = async () => {
  await ensurePluginConfigExists()
  const config = await readPluginConfig()
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
    failedKeys.add(failedKey)
    currentKeyIndex = currentKeyIndex + 1
    if (currentKeyIndex >= uniqueKeys.length) {
      currentKeyIndex = 0
    }
    while (failedKeys.has(uniqueKeys[currentKeyIndex])) {
      currentKeyIndex++
      if (currentKeyIndex >= uniqueKeys.length) {
        currentKeyIndex = 0
      }
    }
    await updateOllamaMultiKey(uniqueKeys[currentKeyIndex], providerId)
  }

  return {
    auth: {
      provider: providerId,
      loader: async () => {
        return {
          apiKey: '',
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            let attempts = 0
            
            while (attempts < uniqueKeys.length) {
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
                attempts++
                continue
              }
              
              return response
            }
            
            throw new Error(`[${providerId}] ALL KEYS EXHAUSTED! ${uniqueKeys.length} keys have rate limit errors. Please wait and retry later.`)
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
