import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
const STATE_FILE = join(homedir(), '.opencode', 'ollama-keys-state.json');
const FAIL_WINDOW_MS = 5 * 60 * 60 * 1000;
export function loadKeyState(apiKeys) {
    try {
        if (existsSync(STATE_FILE)) {
            const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
            const existingKeys = new Map(data.keys.map(k => [k.key, k]));
            const keys = apiKeys.map(key => {
                const existing = existingKeys.get(key);
                if (existing) {
                    if (existing.failedAt && Date.now() - existing.failedAt > FAIL_WINDOW_MS) {
                        return { key, failedAt: null };
                    }
                    return existing;
                }
                return { key, failedAt: null };
            });
            return { keys, lastUpdated: Date.now() };
        }
    }
    catch (e) {
        console.error('Failed to load key state:', e);
    }
    return {
        keys: apiKeys.map(key => ({ key, failedAt: null })),
        lastUpdated: Date.now()
    };
}
export function saveKeyState(state) {
    try {
        const dir = join(homedir(), '.opencode');
        const fs = require('fs');
        if (!existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    }
    catch (e) {
        console.error('Failed to save key state:', e);
    }
}
export function markKeyFailed(state, keyIndex) {
    if (keyIndex >= 0 && keyIndex < state.keys.length) {
        state.keys[keyIndex].failedAt = Date.now();
        saveKeyState(state);
    }
}
export function getAvailableKeys(state) {
    return state.keys
        .map((k, i) => ({ key: k.key, index: i }))
        .filter(({ key }) => {
        const stateKey = state.keys.find(sk => sk.key === key);
        return !stateKey?.failedAt || Date.now() - stateKey.failedAt > FAIL_WINDOW_MS;
    });
}
export function getWorkingKey(state) {
    const available = getAvailableKeys(state);
    if (available.length > 0) {
        return available[0].key;
    }
    return state.keys[0]?.key || null;
}
