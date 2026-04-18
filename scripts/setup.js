#!/usr/bin/env node

import { existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import readline from 'readline';

const CONFIG_PATH = join(homedir(), '.config', 'opencode', 'opencode.json');
const AUTH_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
const PLUGIN_CONFIG_PATH = join(homedir(), '.config', 'opencode', 'ollama-multi-auth.json');
const IS_INTERACTIVE = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    // Ignore if exists
  }
}

async function setup() {
  console.log('\n🦙 Welcome to opencode-ollama-multi-auth!\n');
  console.log('This plugin helps you use multiple Ollama Cloud API keys with automatic failover.\n');
  
  // Check if OpenCode is installed
  const opencodeExists = existsSync(join(homedir(), '.config', 'opencode'));
  if (!opencodeExists) {
    console.log('⚠️  OpenCode config directory not found.');
    console.log('Please make sure you have OpenCode installed and have run it at least once.\n');
    rl.close();
    return;
  }
  
  // Check if already configured
  let existingConfig = {};
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    existingConfig = JSON.parse(content);
    console.log('✓ Found existing OpenCode configuration\n');
  } catch {
    console.log('Creating new OpenCode configuration...\n');
  }
  
  // Check if plugin is already in config
  const hasPlugin = existingConfig.plugin?.some(p => {
    if (Array.isArray(p)) return p[0]?.includes('ollama-multi');
    return p?.includes('ollama-multi');
  });
  
  if (hasPlugin) {
    console.log('✓ Plugin is already configured in opencode.json\n');
  } else {
    existingConfig.model = existingConfig.model || 'ollama-multi/kimi-k2.5';
    existingConfig.provider = existingConfig.provider || {};
    existingConfig.provider['ollama-multi'] = {
      npm: '@ai-sdk/openai-compatible',
      options: {
        baseURL: 'https://ollama.com/v1'
      },
      models: {
        'kimi-k2.5': { id: 'kimi-k2.5', name: 'Kimi K2.5', family: 'kimi' },
        'qwen3.5:397b': { id: 'qwen3.5:397b', name: 'Qwen 3.5 397B', family: 'qwen' },
        'gemma4:31b-cloud': { id: 'gemma4:31b-cloud', name: 'Gemma 4 31B', family: 'gemma' }
      }
    };

    existingConfig.plugin = existingConfig.plugin || [];
    existingConfig.plugin = existingConfig.plugin.filter(p => {
      if (Array.isArray(p)) return !p[0]?.includes('ollama-multi');
      return !p?.includes('ollama-multi');
    });

    existingConfig.plugin.push('opencode-ollama-multi-auth');

    await ensureDir(join(homedir(), '.config', 'opencode'));
    await writeFile(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));
    console.log('✓ Registered plugin in opencode.json');
  }

  console.log('Let\'s set up the plugin configuration file.\n');

  if (!IS_INTERACTIVE) {
    if (!existsSync(PLUGIN_CONFIG_PATH)) {
      await ensureDir(join(homedir(), '.config', 'opencode'));
      await writeFile(PLUGIN_CONFIG_PATH, JSON.stringify({
        providerId: 'ollama-multi',
        keys: []
      }, null, 2));
      console.log(`✓ Created ${PLUGIN_CONFIG_PATH}`);
    } else {
      console.log(`✓ Found ${PLUGIN_CONFIG_PATH}`);
    }

    console.log('ℹ️  Non-interactive terminal detected.');
    console.log('   Add your API keys manually in the plugin config file.\n');
    rl.close();
    return;
  }

  console.log('Enter your Ollama Cloud API keys (one per line).');
  console.log('Press Enter twice when done.\n');

  const keys = [];
  while (true) {
    const key = await question(`API Key ${keys.length + 1}: `);
    if (!key) break;
    keys.push(key);
  }

  if (keys.length === 0) {
    console.log('\n⚠️  No keys provided. Skipping configuration.');
    console.log(`You can configure keys later in ${PLUGIN_CONFIG_PATH}\n`);
    rl.close();
    return;
  }

  await ensureDir(join(homedir(), '.config', 'opencode'));
  await writeFile(PLUGIN_CONFIG_PATH, JSON.stringify({
    providerId: 'ollama-multi',
    keys
  }, null, 2));

  // Initialize auth.json with first key
  await ensureDir(join(homedir(), '.local', 'share', 'opencode'));
  let auth = {};
  try {
    auth = JSON.parse(await readFile(AUTH_PATH, 'utf-8'));
  } catch {}

  auth['ollama-multi'] = {
    type: 'api',
    key: keys[0]
  };

  await writeFile(AUTH_PATH, JSON.stringify(auth, null, 2));

  console.log('\n✅ Setup complete!');
  console.log(`\n✓ Added ${keys.length} API key(s)`);
  console.log(`✓ Wrote ${PLUGIN_CONFIG_PATH}`);
  console.log('✓ Initialized auth.json');
  console.log('\nRestart OpenCode to start using ollama-multi models!\n');
  
  rl.close();
}

setup().catch(err => {
  console.error('Setup error:', err);
  process.exit(1);
});
