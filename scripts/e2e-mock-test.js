#!/usr/bin/env node

import http from 'http';
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = 11434;
const MOCK_URL = `http://127.0.0.1:${PORT}/v1`;

// Keys to test
const keys = ['key-1-fails', 'key-2-fails', 'key-3-succeeds'];

// Track requests received by the mock server
const receivedKeys = [];

// Create a mock HTTP server
const server = http.createServer((req, res) => {
  // Extract Bearer token
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    receivedKeys.push(token);
    console.log(`[Mock Server] Received request with token: ${token}`);
    
    if (token === 'key-3-succeeds') {
      // Success response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'kimi-k2.5',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello! I am a mock response from the server.'
          },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      }));
    } else {
      // Rate limit response
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `you (${token}) have reached your weekly usage limit`
      }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, async () => {
  console.log(`[Mock Server] Listening on ${MOCK_URL}`);
  
  // Set up isolated environment
  const testDir = mkdtempSync(join(tmpdir(), 'opencode-ollama-e2e-'));
  
  try {
    const configDir = join(testDir, '.config', 'opencode');
    const shareDir = join(testDir, '.local', 'share', 'opencode');
    const stateDir = join(testDir, '.opencode');
    
    mkdirSync(configDir, { recursive: true });
    mkdirSync(shareDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    
    // Write opencode.json
    const config = {
      $schema: 'https://opencode.ai/config.json',
      model: 'ollama-multi/kimi-k2.5',
      provider: {
        'ollama-multi': {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: MOCK_URL
          },
          models: {
            'kimi-k2.5': { id: 'kimi-k2.5', name: 'Kimi K2.5', family: 'kimi' }
          }
        }
      },
      plugin: [
        [join(process.cwd(), 'dist', 'index.js'), {
          ollamaMultiAuth: {
            keys: keys,
            failWindowMs: 5000,
            maxRetries: 5
          }
        }]
      ]
    };
    
    writeFileSync(join(configDir, 'opencode.json'), JSON.stringify(config, null, 2));
    
    // Write initial auth.json
    writeFileSync(join(shareDir, 'auth.json'), JSON.stringify({
      'ollama-multi': { type: 'api', key: keys[0] }
    }, null, 2));
    
    console.log(`[Test] Environment created at ${testDir}`);
    console.log(`[Test] Running opencode run "Say hello"...`);
    
    // Run opencode CLI - use full path on macOS
    const opencodePath = '/Applications/OpenCode.app/Contents/MacOS/opencode';
    const env = {
      ...process.env,
      HOME: testDir
    };
    
    const proc = spawn(opencodePath, ['run', 'Say hello'], {
      env,
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      console.log(`\n[Test] OpenCode exited with code ${code}`);
      
      // Verify rotation happened
      console.log(`\n[Test] Verification:`);
      console.log(`Expected key sequence: ${keys.join(' -> ')}`);
      console.log(`Actual key sequence:   ${receivedKeys.join(' -> ')}`);
      
      if (receivedKeys.length === 3 && 
          receivedKeys[0] === 'key-1-fails' &&
          receivedKeys[1] === 'key-2-fails' &&
          receivedKeys[2] === 'key-3-succeeds') {
        console.log(`\n✅ TEST PASSED: The plugin successfully cycled through the rate-limited keys and succeeded on the working key.`);
      } else {
        console.log(`\n❌ TEST FAILED: Key rotation did not behave as expected.`);
        process.exitCode = 1;
      }
      
      // Cleanup
      rmSync(testDir, { recursive: true, force: true });
      server.close();
    });
    
  } catch (err) {
    console.error('[Test] Error:', err);
    rmSync(testDir, { recursive: true, force: true });
    server.close();
    process.exit(1);
  }
});
