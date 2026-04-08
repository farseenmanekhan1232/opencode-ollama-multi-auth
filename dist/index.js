import { loadKeyState, saveKeyState, markKeyFailed, getWorkingKey } from './state.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
async function readExistingOllamaCloudKey() {
    try {
        const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
        const content = await readFile(authPath, 'utf-8');
        const auth = JSON.parse(content);
        return auth['ollama-cloud']?.apiKey || null;
    }
    catch {
        return null;
    }
}
function getApiKeysFromEnv() {
    const keys = [];
    const seen = new Set();
    const mainKey = process.env.OLLAMA_API_KEY;
    if (mainKey && !seen.has(mainKey)) {
        seen.add(mainKey);
        keys.unshift(mainKey);
    }
    let i = 1;
    while (true) {
        const envKey = `OLLAMA_API_KEY_${i}`;
        const value = process.env[envKey];
        if (!value)
            break;
        if (!seen.has(value)) {
            seen.add(value);
            keys.push(value);
        }
        i++;
    }
    return keys;
}
function extractApiKeysFromConfig(options) {
    const keys = [];
    if (Array.isArray(options.keys)) {
        keys.push(...options.keys.filter((k) => typeof k === 'string'));
    }
    if (options.key && typeof options.key === 'string') {
        keys.push(options.key);
    }
    return keys;
}
function deduplicateKeys(keys) {
    const unique = [];
    const seen = new Set();
    for (const key of keys) {
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(key);
        }
    }
    return unique;
}
export const OllamaMultiAuth = async (_, options) => {
    console.log('[ollama-multi-auth] Plugin loaded, raw options:', JSON.stringify(options).substring(0, 500));
    const config = options?.ollamaMultiAuth || {};
    const configKeys = extractApiKeysFromConfig(options);
    const envKeys = getApiKeysFromEnv();
    const existingKey = await readExistingOllamaCloudKey();
    const allKeys = [
        ...configKeys,
        ...envKeys,
        ...(existingKey ? [existingKey] : [])
    ];
    const uniqueKeys = deduplicateKeys(allKeys);
    if (uniqueKeys.length === 0) {
        console.warn('[ollama-multi-auth] No API keys configured');
        return {};
    }
    console.log(`[ollama-multi-auth] Loaded ${uniqueKeys.length} API keys (config: ${configKeys.length}, env: ${envKeys.length}, existing: ${existingKey ? 1 : 0})`);
    let keyState = loadKeyState(uniqueKeys);
    function getAvailableKeys() {
        const failWindow = config.failWindowMs || 18000000;
        return keyState.keys
            .map((k, i) => ({ key: k.key, index: i }))
            .filter(k => {
            const state = keyState.keys[k.index];
            return !state.failedAt || Date.now() - state.failedAt > failWindow;
        });
    }
    let currentKeyIndex = 0;
    function getNextApiKey() {
        const available = getAvailableKeys();
        if (available.length === 0) {
            console.warn('[ollama-multi-auth] All keys failed recently, using first key');
            currentKeyIndex = 0;
            return keyState.keys[0]?.key || '';
        }
        const nextKey = available[0];
        currentKeyIndex = nextKey.index;
        console.log(`[ollama-multi-auth] Using key ${currentKeyIndex + 1}/${keyState.keys.length} (${keyState.keys[currentKeyIndex].key.substring(0, 20)}...)`);
        return nextKey.key;
    }
    return {
        auth: {
            provider: 'ollama-cloud',
            loader: async () => {
                const apiKey = getNextApiKey();
                return {
                    apiKey,
                    async fetch(input, init) {
                        const maxRetries = keyState.keys.length;
                        let lastError = null;
                        for (let attempt = 0; attempt < maxRetries; attempt++) {
                            const currentKey = getNextApiKey();
                            const headers = new Headers(init?.headers);
                            headers.set('Authorization', `Bearer ${currentKey}`);
                            try {
                                const response = await fetch(input, {
                                    ...init,
                                    headers
                                });
                                if (response.status === 401 || response.status === 403 || response.status === 429) {
                                    console.log(`[ollama-multi-auth] Key ${currentKeyIndex + 1} failed with ${response.status}, rotating...`);
                                    markKeyFailed(keyState, currentKeyIndex);
                                    keyState = loadKeyState(uniqueKeys);
                                    saveKeyState(keyState);
                                    continue;
                                }
                                return response;
                            }
                            catch (error) {
                                lastError = error;
                                console.log(`[ollama-multi-auth] Request failed: ${error}`);
                                continue;
                            }
                        }
                        throw lastError || new Error('All API keys failed');
                    }
                };
            },
            methods: [
                {
                    type: 'api',
                    label: 'Ollama Cloud API Key (Multi-Auth)',
                },
            ],
        },
        'tool.execute.after': async ({ tool, sessionID }, { title, output, metadata }) => {
            const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
            const isAuthError = outputStr.includes('401') ||
                outputStr.includes('403') ||
                outputStr.includes('authentication') ||
                outputStr.includes('api key') ||
                outputStr.includes('invalid') ||
                outputStr.includes('unauthorized') ||
                outputStr.includes('429') ||
                outputStr.includes('rate limit');
            if (isAuthError) {
                console.log(`[ollama-multi-auth] Key ${currentKeyIndex + 1} marked as failed (detected in tool output)`);
                console.log(`[ollama-multi-auth] Tool: ${tool}, Session: ${sessionID}`);
                markKeyFailed(keyState, currentKeyIndex);
                saveKeyState(keyState);
                keyState = loadKeyState(uniqueKeys);
                const newWorkingKey = getWorkingKey(keyState);
                if (newWorkingKey) {
                    currentKeyIndex = keyState.keys.findIndex(k => k.key === newWorkingKey);
                }
            }
        },
    };
};
export default OllamaMultiAuth;
