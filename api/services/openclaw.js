// OpenClaw daemon manager
// Starts openclaw as a child process and provides a chat interface
// via its OpenAI-compatible HTTP API at http://127.0.0.1:18789

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const OPENCLAW_PORT = 18789;
const BASE_URL = `http://127.0.0.1:${OPENCLAW_PORT}`;
const CONFIG_DIR = '/tmp/.openclaw';
const CONFIG_FILE = path.join(CONFIG_DIR, 'openclaw.json');

let proc = null;
let ready = false;

function getBinPath() {
  // openclaw bin is at node_modules/.bin/openclaw (symlink on Linux/macOS)
  // or find the .mjs file directly
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.bin', 'openclaw'),
    path.join(__dirname, '../../node_modules', '.bin', 'openclaw'),
    path.join(__dirname, '..', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(__dirname, '../../node_modules', 'openclaw', 'openclaw.mjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function writeConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  // Build config — provider determined by OPENCLAW_MODEL env var
  // Format: "provider/model" e.g. "openai/gpt-4o-mini"
  const model = process.env.OPENCLAW_MODEL || 'openai/gpt-4o-mini';

  const config = {
    agent: { model },
    gateway: {
      http: {
        endpoints: {
          chatCompletions: { enabled: true }
        }
      }
    }
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function waitForReady(maxMs = 45000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await axios.get(`${BASE_URL}/v1/models`, { timeout: 2000 });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return false;
}

async function start() {
  // openclaw requires Node >= 22
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 22) {
    console.warn(`[openclaw] Requires Node.js >= 22 (current: ${process.versions.node}). Skipping.`);
    return;
  }

  if (proc) return; // already running

  try {
    writeConfig();

    const binPath = getBinPath();
    if (!binPath) {
      console.warn('[openclaw] Binary not found — run npm install. Skipping.');
      return;
    }

    const env = {
      ...process.env,
      OPENCLAW_CONFIG_PATH: CONFIG_FILE,
      OPENCLAW_STATE_DIR: CONFIG_DIR
    };

    // If running a .mjs file, invoke with node directly
    const args = binPath.endsWith('.mjs')
      ? [binPath]
      : [binPath];
    const cmd = binPath.endsWith('.mjs') ? process.execPath : binPath;

    proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', d => process.stdout.write(`[openclaw] ${d}`));
    proc.stderr.on('data', d => process.stderr.write(`[openclaw] ${d}`));

    proc.on('exit', code => {
      console.log(`[openclaw] Daemon exited (code ${code})`);
      proc = null;
      ready = false;
    });

    const ok = await waitForReady();
    if (ok) {
      ready = true;
      console.log('[openclaw] Daemon ready on port', OPENCLAW_PORT);
    } else {
      console.warn('[openclaw] Daemon did not become ready in 45s');
    }
  } catch (e) {
    console.error('[openclaw] Failed to start:', e.message);
  }
}

async function chat(message, systemPrompt) {
  if (!ready) throw new Error('openclaw daemon not ready');

  const response = await axios.post(
    `${BASE_URL}/v1/chat/completions`,
    {
      model: 'openclaw:main',
      messages: [
        { role: 'system', content: systemPrompt || 'You are a helpful AI assistant.' },
        { role: 'user', content: message }
      ],
      stream: false
    },
    { timeout: 30000 }
  );

  const choice = response.data.choices[0];
  return {
    content: choice.message.content,
    model: response.data.model || 'openclaw',
    tokens: response.data.usage?.total_tokens || 0
  };
}

function isReady() { return ready; }

function stop() {
  if (proc) {
    proc.kill();
    proc = null;
    ready = false;
  }
}

module.exports = { start, stop, chat, isReady };
