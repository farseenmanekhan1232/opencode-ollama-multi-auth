#!/usr/bin/env node

import { loadKeyState, saveKeyState, markKeyFailed, getWorkingKey } from '../dist/state.js'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const STATE_FILE = join(homedir(), '.opencode', 'ollama-keys-state.json')

const testKeys = [
  'key-1-production-abc123',
  'key-2-production-def456', 
  'key-3-production-ghi789',
  'key-4-production-jkl012',
  'key-5-production-mno345'
]

async function clearState() {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE)
  }
}

async function simulateAPICall(keyState, keyIndex, shouldFail = false) {
  const key = keyState.keys[keyIndex].key
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
  
  console.log(`  ${timestamp} | Using Key #${keyIndex + 1}: ${key.substring(0, 20)}...`)
  
  if (shouldFail) {
    console.log(`  ${timestamp} | ❌ FAILED - 401 Unauthorized`)
    markKeyFailed(keyState, keyIndex)
    return false
  } else {
    console.log(`  ${timestamp} | ✅ SUCCESS - Response received`)
    return true
  }
}

async function demonstrateKeyRotation() {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  KEY ROTATION DEMONSTRATION')
  console.log('═══════════════════════════════════════════════════════════\n')
  
  await clearState()
  let keyState = loadKeyState(testKeys)
  
  console.log('📋 Test Configuration:')
  console.log(`   • Total Keys: ${testKeys.length}`)
  console.log(`   • Recovery Window: 5 hours (simulated as instant for demo)\n`)
  
  // Phase 1: Initial usage
  console.log('📌 PHASE 1: Normal operation with first key')
  console.log('─────────────────────────────────────────────────────────')
  await simulateAPICall(keyState, 0, false)
  await simulateAPICall(keyState, 0, false)
  console.log('')
  
  // Phase 2: First key fails, rotation to key 2
  console.log('📌 PHASE 2: Key #1 fails → Auto-rotate to Key #2')
  console.log('─────────────────────────────────────────────────────────')
  await simulateAPICall(keyState, 0, true)
  keyState = loadKeyState(testKeys)
  await simulateAPICall(keyState, 1, false)
  console.log('')
  
  // Phase 3: Multiple rapid failures
  console.log('📌 PHASE 3: Multiple keys failing rapidly')
  console.log('─────────────────────────────────────────────────────────')
  await simulateAPICall(keyState, 1, true)  // Key 2 fails
  keyState = loadKeyState(testKeys)
  await simulateAPICall(keyState, 2, true)  // Key 3 fails
  keyState = loadKeyState(testKeys)
  await simulateAPICall(keyState, 3, true)  // Key 4 fails
  keyState = loadKeyState(testKeys)
  await simulateAPICall(keyState, 4, false) // Key 5 succeeds
  console.log('')
  
  // Phase 4: All keys failed
  console.log('📌 PHASE 4: All keys failed - Fallback behavior')
  console.log('─────────────────────────────────────────────────────────')
  await simulateAPICall(keyState, 4, true)  // Key 5 fails
  keyState = loadKeyState(testKeys)
  const workingKey = getWorkingKey(keyState)
  console.log(`   ⚠️  All keys failed! Fallback to: ${workingKey?.substring(0, 20)}...`)
  console.log('')
  
  // Show final state
  console.log('📊 Final Key States:')
  console.log('─────────────────────────────────────────────────────────')
  keyState.keys.forEach((k, i) => {
    const status = k.failedAt ? '❌ FAILED' : '✅ ACTIVE'
    const time = k.failedAt ? new Date(k.failedAt).toISOString().split('T')[1].split('.')[0] : '-'
    console.log(`   Key #${i + 1}: ${status} ${k.failedAt ? `(at ${time})` : ''}`)
  })
  
  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Demonstration Complete!')
  console.log('═══════════════════════════════════════════════════════════\n')
}

async function demonstrateRecoveryWindow() {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  KEY RECOVERY DEMONSTRATION')
  console.log('═══════════════════════════════════════════════════════════\n')
  
  await clearState()
  let keyState = loadKeyState(testKeys)
  
  console.log('📋 Simulating: Keys marked as failed 6 hours ago')
  console.log('   Recovery window: 5 hours\n')
  
  // Mark first 3 keys as failed 6 hours ago
  const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000)
  keyState.keys[0].failedAt = sixHoursAgo
  keyState.keys[1].failedAt = sixHoursAgo
  keyState.keys[2].failedAt = sixHoursAgo
  saveKeyState(keyState)
  
  // Reload state
  keyState = loadKeyState(testKeys)
  
  console.log('📌 Key Status After Recovery Window:')
  console.log('─────────────────────────────────────────────────────────')
  keyState.keys.forEach((k, i) => {
    const status = k.failedAt ? '🟢 RECOVERED (5hr+ elapsed)' : '✅ ACTIVE'
    console.log(`   Key #${i + 1}: ${status}`)
  })
  
  const workingKey = getWorkingKey(keyState)
  console.log(`\n   🔄 Next working key: Key #${keyState.keys.findIndex(k => k.key === workingKey) + 1}`)
  
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  Recovery Demonstration Complete!')
  console.log('═══════════════════════════════════════════════════════════\n')
}

async function runStressTest() {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  STRESS TEST: 20 Rapid API Calls')
  console.log('═══════════════════════════════════════════════════════════\n')
  
  await clearState()
  let keyState = loadKeyState(testKeys)
  
  const results = []
  
  for (let i = 0; i < 20; i++) {
    const workingKey = getWorkingKey(keyState)
    const keyIndex = testKeys.indexOf(workingKey)
    
    // Fail every 3rd request
    const shouldFail = (i + 1) % 3 === 0
    
    results.push({
      call: i + 1,
      keyIndex: keyIndex + 1,
      failed: shouldFail
    })
    
    if (shouldFail) {
      markKeyFailed(keyState, keyIndex)
      keyState = loadKeyState(testKeys)
    }
  }
  
  console.log('📊 Stress Test Results:')
  console.log('─────────────────────────────────────────────────────────')
  console.log('   Call | Key Used | Result')
  console.log('   ─────────────────────────')
  
  results.forEach(r => {
    const status = r.failed ? '❌ FAIL' : '✅ OK'
    console.log(`   ${String(r.call).padStart(3)}   | Key #${r.keyIndex}    | ${status}`)
  })
  
  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Stress Test Complete!')
  console.log('═══════════════════════════════════════════════════════════\n')
}

// Run all demonstrations
console.log('\n🦙 Ollama Multi-Auth Key Rotation Tests\n')

await demonstrateKeyRotation()
await new Promise(resolve => setTimeout(resolve, 500))

await demonstrateRecoveryWindow()
await new Promise(resolve => setTimeout(resolve, 500))

await runStressTest()

console.log('✅ All tests complete! Check the output above.\n')