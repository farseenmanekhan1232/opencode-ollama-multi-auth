#!/usr/bin/env node

/**
 * Isolated Test Environment for Ollama Multi-Auth
 * 
 * This script creates a temporary isolated environment to test
 * key rotation without affecting your actual OpenCode setup.
 */

import { spawn } from 'child_process';
import { 
  mkdtempSync, 
  writeFileSync, 
  mkdirSync,
  existsSync,
  rmSync,
  readFileSync,
  copyFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

class TestEnvironment {
  constructor() {
    this.testDir = null;
    this.originalHome = process.env.HOME;
  }

  create() {
    // Create temp directory
    this.testDir = mkdtempSync(join(tmpdir(), 'opencode-ollama-test-'));
    console.log(`📁 Created test environment: ${this.testDir}`);

    // Create directory structure
    const dirs = [
      join(this.testDir, '.config', 'opencode'),
      join(this.testDir, '.local', 'share', 'opencode'),
      join(this.testDir, '.opencode')
    ];
    
    dirs.forEach(dir => mkdirSync(dir, { recursive: true }));

    return this.testDir;
  }

  setupConfig(keys) {
    // Write opencode.json
    const config = {
      $schema: 'https://opencode.ai/config.json',
      model: 'ollama-multi/kimi-k2.5',
      provider: {
        'ollama-multi': {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: 'https://ollama.com/v1'
          },
          models: {
            'kimi-k2.5': { 
              id: 'kimi-k2.5', 
              name: 'Kimi K2.5', 
              family: 'kimi' 
            },
            'qwen3.5:397b': { 
              id: 'qwen3.5:397b', 
              name: 'Qwen 3.5 397B', 
              family: 'qwen' 
            },
            'gemma4:31b-cloud': { 
              id: 'gemma4:31b-cloud', 
              name: 'Gemma 4 31B', 
              family: 'gemma' 
            }
          }
        }
      },
      plugin: [
        ['opencode-ollama-multi-auth', {
          ollamaMultiAuth: {
            keys: keys,
            failWindowMs: 5000  // 5 seconds for fast testing
          }
        }]
      ]
    };

    writeFileSync(
      join(this.testDir, '.config', 'opencode', 'opencode.json'),
      JSON.stringify(config, null, 2)
    );

    // Write initial auth.json with first key
    const auth = {
      'ollama-multi': {
        type: 'api',
        key: keys[0]
      }
    };

    writeFileSync(
      join(this.testDir, '.local', 'share', 'opencode', 'auth.json'),
      JSON.stringify(auth, null, 2)
    );

    console.log('✅ Configuration files created');
  }

  runOpenCode(args = []) {
    console.log(`\n🚀 Starting OpenCode in test environment...\n`);
    console.log('═══════════════════════════════════════════════════════════');
    
    const env = {
      ...process.env,
      HOME: this.testDir,
      // Ensure we can find the plugin
      NODE_PATH: join(this.testDir, 'node_modules')
    };

    const proc = spawn('opencode', args, {
      env,
      stdio: 'inherit',
      cwd: this.testDir
    });

    return proc;
  }

  showStatus() {
    const authPath = join(this.testDir, '.local', 'share', 'opencode', 'auth.json');
    const statePath = join(this.testDir, '.opencode', 'ollama-keys-state.json');

    console.log('\n📊 Test Environment Status:');
    console.log('═══════════════════════════════════════════════════════════');
    
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
      console.log('\n📝 auth.json (Current active key):');
      console.log(JSON.stringify(auth, null, 2));
    } else {
      console.log('\n📝 auth.json: Not created yet');
    }

    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      console.log('\n🗄️  Key State:');
      state.keys.forEach((k, i) => {
        const status = k.failedAt ? '❌ FAILED' : '✅ ACTIVE';
        const time = k.failedAt ? new Date(k.failedAt).toLocaleTimeString() : '-';
        console.log(`   Key #${i + 1}: ${status} ${k.failedAt ? `(failed at ${time})` : ''}`);
      });
    } else {
      console.log('\n🗄️  Key State: No failures yet');
    }
    
    console.log('\n═══════════════════════════════════════════════════════════\n');
  }

  cleanup() {
    if (this.testDir && existsSync(this.testDir)) {
      console.log(`\n🧹 Cleaning up: ${this.testDir}`);
      rmSync(this.testDir, { recursive: true, force: true });
      console.log('✅ Test environment cleaned up');
    }
  }
}

// Mock key generator for testing
function generateMockKeys(count) {
  return Array.from({ length: count }, (_, i) => 
    `test-key-${i + 1}-${Math.random().toString(36).substring(2, 10)}`
  );
}

async function runInteractiveTest() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  🦙 Ollama Multi-Auth Test Environment');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('This will create an isolated test environment for OpenCode');
  console.log('with the ollama-multi-auth plugin configured.\n');
  
  const testEnv = new TestEnvironment();
  
  try {
    // Create environment
    testEnv.create();
    
    // Ask for keys or use mock keys
    const useMock = await question('Use mock keys for testing? (y/n): ');
    let keys;
    
    if (useMock.toLowerCase() === 'y') {
      const keyCount = parseInt(await question('How many mock keys? (default: 5): ')) || 5;
      keys = generateMockKeys(keyCount);
      console.log(`\n✅ Generated ${keyCount} mock keys`);
      keys.forEach((k, i) => console.log(`   Key #${i + 1}: ${k.substring(0, 30)}...`));
    } else {
      console.log('\nEnter your real Ollama Cloud API keys (one per line):');
      console.log('Press Enter twice when done.\n');
      
      keys = [];
      while (true) {
        const key = await question(`API Key ${keys.length + 1}: `);
        if (!key) break;
        keys.push(key);
      }
      
      if (keys.length === 0) {
        console.log('No keys provided. Using mock keys.');
        keys = generateMockKeys(3);
      }
    }
    
    // Setup configuration
    testEnv.setupConfig(keys);
    
    // Show initial status
    testEnv.showStatus();
    
    // Ask what to do
    console.log('\nWhat would you like to do?');
    console.log('1. Start OpenCode interactively');
    console.log('2. Run automated key rotation test');
    console.log('3. Show current status');
    console.log('4. Clean up and exit');
    
    const choice = await question('\nChoice (1-4): ');
    
    switch (choice) {
      case '1':
        const proc = testEnv.runOpenCode();
        proc.on('exit', (code) => {
          console.log(`\nOpenCode exited with code ${code}`);
          testEnv.showStatus();
          askCleanup(testEnv);
        });
        return; // Don't cleanup yet
        
      case '2':
        await runAutomatedTest(testEnv, keys);
        break;
        
      case '3':
        testEnv.showStatus();
        break;
        
      case '4':
        break;
        
      default:
        console.log('Invalid choice');
    }
    
    askCleanup(testEnv);
    
  } catch (error) {
    console.error('Test error:', error);
    testEnv.cleanup();
    process.exit(1);
  }
}

async function runAutomatedTest(testEnv, keys) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  🔬 Automated Key Rotation Test');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('This test will:');
  console.log('1. Simulate API calls with each key');
  console.log('2. Mark keys as failed on certain calls');
  console.log('3. Show rotation behavior\n');
  
  const statePath = join(testEnv.testDir, '.opencode', 'ollama-keys-state.json');
  const authPath = join(testEnv.testDir, '.local', 'share', 'opencode', 'auth.json');
  
  // Simulate 10 API calls
  for (let i = 0; i < 10; i++) {
    console.log(`\n📡 Simulating API Call #${i + 1}:`);
    console.log('─'.repeat(50));
    
    // Read current auth
    const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
    const currentKey = auth['ollama-multi'].key;
    const keyIndex = keys.indexOf(currentKey) + 1;
    
    console.log(`   Using Key #${keyIndex}: ${currentKey.substring(0, 30)}...`);
    
    // Simulate failure on calls 3, 6, 9
    if (i === 2 || i === 5 || i === 8) {
      console.log('   ❌ API returned 401 Unauthorized');
      console.log('   🔄 Rotating to next key...');
      
      // Update state
      let state = { keys: keys.map(k => ({ key: k, failedAt: null })), lastUpdated: Date.now() };
      if (existsSync(statePath)) {
        state = JSON.parse(readFileSync(statePath, 'utf-8'));
      }
      
      // Mark current key as failed
      const failedIndex = keys.indexOf(currentKey);
      state.keys[failedIndex].failedAt = Date.now();
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      
      // Find next available key
      const nextKey = state.keys.find(k => !k.failedAt);
      if (nextKey) {
        auth['ollama-multi'].key = nextKey.key;
        writeFileSync(authPath, JSON.stringify(auth, null, 2));
        const nextIndex = keys.indexOf(nextKey.key) + 1;
        console.log(`   ✅ Switched to Key #${nextIndex}`);
      } else {
        console.log('   ⚠️  No available keys left! Using fallback.');
      }
    } else {
      console.log('   ✅ API call successful');
    }
    
    // Small delay for visibility
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Test Complete!');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Show final status
  testEnv.showStatus();
}

function askCleanup(testEnv) {
  question('\nClean up test environment? (y/n): ').then(answer => {
    if (answer.toLowerCase() === 'y') {
      testEnv.cleanup();
    } else {
      console.log(`\n💾 Test environment preserved at: ${testEnv.testDir}`);
      console.log('You can manually inspect it or delete it later.');
    }
    rl.close();
  });
}

// Run the test
runInteractiveTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
