#!/usr/bin/env node

import http from 'http';
import { spawn } from 'child_process';

const PORT = 11435;
const MOCK_URL = `http://127.0.0.1:${PORT}/v1`;

const keys = ['key-1-fails', 'key-2-fails', 'key-3-succeeds'];
const receivedKeys = [];

const server = http.createServer((req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  console.log(`\n[Mock Server] Received ${req.method} ${req.url} with key: ${token}`);

  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    receivedKeys.push(token);

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`[Mock Server] Key "${token}" -> `, keys.includes(token) ? (token === 'key-3-succeeds' ? 'SUCCESS (200)' : 'RATE LIMIT (429)') : 'UNKNOWN KEY');

      if (token === 'key-3-succeeds') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'mock-model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! This is a response from the mock server. Key rotation test successful!'
            },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        }));
      } else {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
        res.end(JSON.stringify({
          error: {
            message: `Rate limit exceeded for key: ${token}`,
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded'
          }
        }));
      }
    });
  } else if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [{ id: 'mock-model', object: 'model', created: Date.now(), owned_by: 'mock' }]
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`[Mock Server] Running on ${MOCK_URL}`);
  console.log(`[Mock Server] Keys configured:`);
  keys.forEach((k, i) => {
    console.log(`  ${i + 1}. ${k} -> ${k === 'key-3-succeeds' ? 'SUCCESS' : '429 RATE LIMIT'}`);
  });
  console.log(`========================================\n`);
  console.log(`Waiting for requests... (Press Ctrl+C to stop)\n`);
});

process.on('SIGINT', () => {
  console.log(`\n[Mock Server] Received keys in order: ${receivedKeys.join(' -> ')}`);
  console.log('[Mock Server] Shutting down...');
  server.close();
  process.exit(0);
});