import { Plugin } from '@opencode-ai/plugin'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEFAULT_PROVIDER_ID = 'ollama-multi'
const DEFAULT_MAX_RETRIES = 5
const DEFAULT_FAIL_WINDOW_MS = 18000000
const AUTH_JSON_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const STATE_DIR = join(homedir(), '.opencode')
const FAILED_KEYS_STATE_PATH = join(STATE_DIR, 'ollama-keys-state.json')
const PLUGIN_CONFIG_DIR = join(homedir(), '.config', 'opencode')
const PLUGIN_CONFIG_JSON_PATH = join(PLUGIN_CONFIG_DIR, 'ollama-multi-auth.json')
const PLUGIN_CONFIG_JSONC_PATH = join(PLUGIN_CONFIG_DIR, 'ollama-multi-auth.jsonc')

interface OllamaMultiAuthConfig {
  keys?: string[]
  providerId?: string
  maxRetries?: number
  failWindowMs?: number
}

interface FailedKeysStateFile {
  providers?: Record<string, Record<string, number>>
}

function isQuoteEscaped(input: string, quoteIndex: number): boolean {
  let backslashes = 0
  let i = quoteIndex - 1
  while (i >= 0 && input[i] === '\\') {
    backslashes++
    i--
  }
  return backslashes % 2 === 1
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

    if (current === '"' && !isQuoteEscaped(input, i)) {
      inString = !inString
    }

    output += current
    i++
  }

  return output
}

function removeTrailingCommas(input: string): string {
  let output = ''
  let inString = false

  for (let i = 0; i < input.length; i++) {
    const current = input[i]

    if (current === '"' && !isQuoteEscaped(input, i)) {
      inString = !inString
      output += current
      continue
    }

    if (!inString && current === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) {
        j++
      }
      const next = input[j]
      if (next === '}' || next === ']') {
        continue
      }
    }

    output += current
  }

  return output
}

function parseJsonOrJsonc(content: string): OllamaMultiAuthConfig {
  const withoutComments = stripJsonComments(content)
  const withoutTrailingCommas = removeTrailingCommas(withoutComments)
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[ollama-multi-auth] Failed to parse config file at ${path}: ${message}`)
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

async function readFailedKeysStateFile(): Promise<FailedKeysStateFile> {
  try {
    if (!existsSync(FAILED_KEYS_STATE_PATH)) {
      return {}
    }
    const content = await readFile(FAILED_KEYS_STATE_PATH, 'utf-8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    return parsed as FailedKeysStateFile
  } catch {
    return {}
  }
}

async function readFailedKeysForProvider(providerId: string): Promise<Map<string, number>> {
  const state = await readFailedKeysStateFile()
  const providerState = state.providers?.[providerId]
  const entries = Object.entries(providerState || {})
  const map = new Map<string, number>()

  for (const [key, failedAt] of entries) {
    if (typeof key !== 'string') {
      continue
    }
    if (typeof failedAt !== 'number' || !Number.isFinite(failedAt)) {
      continue
    }
    map.set(key, failedAt)
  }

  return map
}

async function writeFailedKeysForProvider(providerId: string, failedKeys: Map<string, number>): Promise<void> {
  const state = await readFailedKeysStateFile()
  const providers = state.providers || {}
  providers[providerId] = Object.fromEntries(failedKeys)

  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(
    FAILED_KEYS_STATE_PATH,
    JSON.stringify({ providers }, null, 2),
    'utf-8',
  )
}

async function updateOllamaMultiKey(key: string, targetProviderId: string): Promise<void> {
  const auth = await readAuthJson()
  const current = auth[targetProviderId]
  if (current?.type === 'api' && current?.key === key) {
    return
  }
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

function getMaxRetries(config: OllamaMultiAuthConfig): number {
  const value = config.maxRetries
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_RETRIES
  }
  if (value < 0) {
    return 0
  }
  return Math.floor(value)
}

function getFailWindowMs(config: OllamaMultiAuthConfig): number {
  const value = config.failWindowMs
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_FAIL_WINDOW_MS
  }
  if (value < 0) {
    return 0
  }
  return Math.floor(value)
}

export const OllamaMultiAuth: Plugin = async () => {
  await ensurePluginConfigExists()
  const config = await readPluginConfig()
  const providerId = config.providerId || DEFAULT_PROVIDER_ID
  const maxRetries = getMaxRetries(config)
  const failWindowMs = getFailWindowMs(config)

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

  const persistedFailedKeys = await readFailedKeysForProvider(providerId)
  const allowedKeys = new Set(uniqueKeys)
  const failedKeys = new Map<string, number>()
  for (const [key, failedAt] of persistedFailedKeys.entries()) {
    if (allowedKeys.has(key)) {
      failedKeys.set(key, failedAt)
    }
  }
  if (failedKeys.size !== persistedFailedKeys.size) {
    await writeFailedKeysForProvider(providerId, failedKeys)
  }

  let currentKeyIndex = 0

  function isKeyAvailable(key: string, now: number): boolean {
    const failedAt = failedKeys.get(key)
    if (failedAt === undefined) {
      return true
    }
    if (now - failedAt >= failWindowMs) {
      failedKeys.delete(key)
      return true
    }
    return false
  }

  async function syncFailedKeysState(): Promise<void> {
    await writeFailedKeysForProvider(providerId, failedKeys)
  }

  function getCurrentKey(): string {
    if (uniqueKeys.length === 0) {
      return ''
    }

    const now = Date.now()
    let scanned = 0
    let index = currentKeyIndex

    while (scanned < uniqueKeys.length) {
      const key = uniqueKeys[index]
      if (isKeyAvailable(key, now)) {
        currentKeyIndex = index
        return key
      }
      index = (index + 1) % uniqueKeys.length
      scanned++
    }

    return ''
  }

  async function rotateToNextKey(failedKey: string): Promise<boolean> {
    failedKeys.set(failedKey, Date.now())
    await syncFailedKeysState()

    const now = Date.now()
    let scanned = 0
    let nextIndex = currentKeyIndex
    while (scanned < uniqueKeys.length) {
      nextIndex = (nextIndex + 1) % uniqueKeys.length
      if (isKeyAvailable(uniqueKeys[nextIndex], now)) {
        currentKeyIndex = nextIndex
        await updateOllamaMultiKey(uniqueKeys[currentKeyIndex], providerId)
        return true
      }
      scanned++
    }

    return false
  }

  return {
    auth: {
      provider: providerId,
      loader: async () => {
        return {
          apiKey: '',
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            let rotations = 0
            
            while (true) {
              const currentKey = getCurrentKey()
              await syncFailedKeysState()
              if (!currentKey) {
                break
              }
              
              const headers = new Headers(init?.headers)
              headers.delete('authorization')
              headers.delete('Authorization')
              headers.set('Authorization', `Bearer ${currentKey}`)
              
              const response = await fetch(input, {
                ...init,
                headers
              })
              
              if (isAuthErrorByStatus(response.status)) {
                if (rotations >= maxRetries) {
                  break
                }

                const rotated = await rotateToNextKey(currentKey)
                if (!rotated) {
                  break
                }

                rotations++
                continue
              }
              
              return response
            }
            
            throw new Error(`[${providerId}] ALL KEYS EXHAUSTED! ${uniqueKeys.length} keys failed with auth/rate-limit errors, maxRetries (${maxRetries}) was reached, or all failed keys are still inside failWindowMs (${failWindowMs}). Please wait and retry later.`)
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
