#!/usr/bin/env node

import { loadKeyState, markKeyFailed, saveKeyState, getWorkingKey } from '../dist/state.js'

const keys = ['key-1-fails', 'key-2-fails', 'key-3-succeeds']

console.log('=== Direct Key Rotation Test ===\n')

let keyState = loadKeyState(keys)
console.log('Initial state - getWorkingKey():', getWorkingKey(keyState))

console.log('\n--- Simulate key-1 failing ---')
markKeyFailed(keyState, 0)
saveKeyState(keyState)
keyState = loadKeyState(keys)
console.log('After key-1 fails, getWorkingKey():', getWorkingKey(keyState))

console.log('\n--- Simulate key-2 failing ---')
markKeyFailed(keyState, 1)
saveKeyState(keyState)
keyState = loadKeyState(keys)
console.log('After key-2 fails, getWorkingKey():', getWorkingKey(keyState))

console.log('\n--- Simulate key-3 (should work) ---')
const working = getWorkingKey(keyState)
if (working === 'key-3-succeeds') {
  console.log('✅ TEST PASSED: Rotation correctly moved to key-3')
} else {
  console.log('❌ TEST FAILED: Expected key-3-succeeds, got:', working)
  process.exit(1)
}

console.log('\n=== State File Contents ===')
console.log(JSON.stringify(keyState, null, 2))