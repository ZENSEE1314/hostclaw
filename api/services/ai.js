const { OpenAI } = require('openai');
const axios = require('axios');
const crypto = require('crypto');

// Get encryption key (same as providers.js)
function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    const key = Buffer.from(envKey);
    if (key.length === 32) return key;
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return crypto.createHash('sha256').update('hostclaw-default-key-change-in-production').digest();
}

function decrypt(text) {
  const algorithm = 'aes-256-cbc';
  const key = getEncryptionKey();
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// HostClaw shared API keys — fallback when user has no keys configured
// Checks both HOSTCLAW_*_KEY and standard env var names (OPENAI_API_KEY, etc.)
function getHostClawKey(provider) {
  const map = {
    openai: process.env.HOSTCLAW_OPENAI_KEY || process.env.OPENAI_API_KEY,
    anthropic: process.env.HOSTCLAW_ANTHROPIC_KEY || process.env.HOSTCLAW_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY,
    kimi: process.env.HOSTCLAW_KIMI_KEY || process.env.KIMI_API_KEY,
    gemini: process.env.HOSTCLAW_GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY,
    deepseek: process.env.HOSTCLAW_DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY,
    groq: process.env.HOSTCLAW_GROQ_KEY || process.env.GROQ_API_KEY,
    nvidia: process.env.HOSTCLAW_NVIDIA_KEY || process.env.NVIDIA_API_KEY
  };
  return map[provider] || null;
}

// Generate AI response using user's configured provider or HostClaw fallback
async function generateAIResponse({ message, provider, providerConfig, skills }) {
  // openclaw is server-hosted — no API key needed
  if (provider === 'openclaw') {
    return callOpenClaw(message, skills);
  }

  // Resolve the API key: user's key first, then HostClaw fallback
  let decryptedKey = null;
  let resolvedProvider = provider;
  let resolvedModel = providerConfig?.model;

  if (providerConfig?.apiKey) {
    // User has their own key — decrypt it
    try {
      decryptedKey = decrypt(providerConfig.apiKey);
    } catch (e) {
      console.error('Failed to decrypt user API key:', e.message);
      // Fall through to HostClaw key
    }
  }

  if (!decryptedKey) {
    // Find the best available server-side API key
    // Priority: user's configured default > HOSTCLAW_DEFAULT_PROVIDER > first available
    const searchOrder = [];

    // 1. Try the requested provider
    if (resolvedProvider) searchOrder.push(resolvedProvider);

    // 2. Try configured default
    const defaultProv = process.env.HOSTCLAW_DEFAULT_PROVIDER;
    if (defaultProv && !searchOrder.includes(defaultProv)) searchOrder.push(defaultProv);

    // 3. Try all providers (groq first — free tier, fast, reliable)
    for (const p of ['groq', 'deepseek', 'openai', 'anthropic', 'gemini', 'kimi', 'nvidia']) {
      if (!searchOrder.includes(p)) searchOrder.push(p);
    }

    for (const p of searchOrder) {
      const key = getHostClawKey(p);
      if (key) {
        decryptedKey = key;
        resolvedProvider = p;
        resolvedModel = process.env.HOSTCLAW_DEFAULT_MODEL || getDefaultModel(p);
        console.log(`AI: using server-side ${p} key`);
        break;
      }
    }
  }

  if (!decryptedKey) {
    return {
      content: '⚠️ No AI provider available. Please add your API key in Settings, or contact support.',
      model: 'none',
      tokens: 0
    };
  }

  const model = resolvedModel || getDefaultModel(resolvedProvider);

  // Try the resolved provider, then fall back to others on failure
  const result = await callProvider(resolvedProvider, decryptedKey, model, message, skills);
  if (!result.error) return result;

  // Primary provider failed — try fallback providers
  console.log(`Primary provider ${resolvedProvider} failed: ${result.content}. Trying fallbacks...`);
  const fallbackOrder = ['groq', 'deepseek', 'openai', 'anthropic', 'gemini', 'kimi', 'nvidia'];
  for (const p of fallbackOrder) {
    if (p === resolvedProvider) continue;
    const key = getHostClawKey(p);
    if (!key) continue;
    console.log(`Trying fallback provider: ${p}`);
    const fallbackResult = await callProvider(p, key, getDefaultModel(p), message, skills);
    if (!fallbackResult.error) return fallbackResult;
    console.log(`Fallback ${p} also failed: ${fallbackResult.content}`);
  }

  // All providers failed
  return result;
}

async function callProvider(provider, apiKey, model, message, skills) {
  try {
    const callers = {
      openai: callOpenAI,
      anthropic: callAnthropic,
      kimi: callKimi,
      gemini: callGemini,
      deepseek: callDeepSeek,
      groq: callGroq,
      nvidia: callNVIDIA,
      openclaw: (msg, key, mdl, sk) => callOpenClaw(msg, sk)
    };
    const fn = callers[provider];
    if (!fn) return { content: 'Unsupported provider: ' + provider, model: 'none', tokens: 0, error: true };
    return await fn(message, apiKey, model, skills);
  } catch (error) {
    console.error(`Error calling ${provider}:`, error.message);
    return {
      content: `⚠️ ${provider} error: ${error.response?.data?.error?.message || error.message}`,
      model: provider,
      tokens: 0,
      error: true
    };
  }
}

async function callOpenAI(message, apiKey, model, skills) {
  const openai = new OpenAI({ apiKey });
  
  const messages = [
    { role: 'system', content: buildSystemPrompt(skills) },
    { role: 'user', content: message }
  ];

  const response = await openai.chat.completions.create({
    model: model,
    messages: messages,
    temperature: 0.7,
    max_tokens: 2000
  });

  return {
    content: response.choices[0].message.content,
    model: response.model,
    tokens: response.usage?.total_tokens || estimateTokens(message + response.choices[0].message.content)
  };
}

async function callAnthropic(message, apiKey, model, skills) {
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: model,
    max_tokens: 2000,
    system: buildSystemPrompt(skills),
    messages: [{ role: 'user', content: message }]
  }, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  }).catch(err => {
    // Log detailed Anthropic error for debugging
    const errData = err.response?.data;
    console.error('Anthropic API error:', JSON.stringify(errData || err.message));
    throw err;
  });

  return {
    content: response.data.content[0].text,
    model: response.data.model,
    tokens: response.data.usage?.input_tokens + response.data.usage?.output_tokens || estimateTokens(message + response.data.content[0].text)
  };
}

async function callKimi(message, apiKey, model, skills) {
  const response = await axios.post('https://api.moonshot.cn/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt(skills) },
      { role: 'user', content: message }
    ],
    temperature: 0.7
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  return {
    content: response.data.choices[0].message.content,
    model: response.data.model,
    tokens: response.data.usage?.total_tokens || estimateTokens(message + response.data.choices[0].message.content)
  };
}

async function callGemini(message, apiKey, model, skills) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      contents: [{
        parts: [{
          text: buildSystemPrompt(skills) + '\n\nUser: ' + message
        }]
      }]
    }
  );

  const text = response.data.candidates[0].content.parts[0].text;
  return {
    content: text,
    model: model,
    tokens: estimateTokens(message + text)
  };
}

async function callDeepSeek(message, apiKey, model, skills) {
  const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt(skills) },
      { role: 'user', content: message }
    ],
    temperature: 0.7
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  return {
    content: response.data.choices[0].message.content,
    model: response.data.model,
    tokens: response.data.usage?.total_tokens || estimateTokens(message + response.data.choices[0].message.content)
  };
}

async function callGroq(message, apiKey, model, skills) {
  const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt(skills) },
      { role: 'user', content: message }
    ],
    temperature: 0.7,
    max_tokens: 2000
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  return {
    content: response.data.choices[0].message.content,
    model: response.data.model,
    tokens: response.data.usage?.total_tokens || estimateTokens(message + response.data.choices[0].message.content)
  };
}

async function callNVIDIA(message, apiKey, model, skills) {
  const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt(skills) },
      { role: 'user', content: message }
    ],
    temperature: 0.7,
    max_tokens: 1024
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  return {
    content: response.data.choices[0].message.content,
    model: response.data.model,
    tokens: response.data.usage?.total_tokens || estimateTokens(message + response.data.choices[0].message.content)
  };
}

async function callOpenClaw(message, skills) {
  const openclawService = require('./openclaw');
  if (!openclawService.isReady()) {
    return {
      content: '⚠️ OpenClaw is not ready. Make sure OPENCLAW_MODEL and the corresponding API key are set, then restart the server.',
      model: 'openclaw',
      tokens: 0,
      error: true
    };
  }
  return openclawService.chat(message, buildSystemPrompt(skills));
}

function buildSystemPrompt(skills) {
  let prompt = `You are a helpful AI assistant running on HostClaw.ai platform. `;
  
  if (skills && skills.length > 0) {
    prompt += `You have access to these skills: ${skills.join(', ')}. `;
    
    if (skills.includes('web_search')) {
      prompt += `For web search queries, indicate you'd search the web. `;
    }
    if (skills.includes('image_gen')) {
      prompt += `For image generation requests, indicate you'd generate an image. `;
    }
    if (skills.includes('code_executor')) {
      prompt += `You can help write and explain code. `;
    }
    if (skills.includes('translator')) {
      prompt += `You can translate between languages. `;
    }
  }
  
  prompt += `Be concise but helpful in your responses.`;
  
  return prompt;
}

function estimateTokens(text) {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

function getDefaultModel(provider) {
  const models = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-20241022',
    kimi: 'moonshot-v1-8k',
    gemini: 'gemini-1.5-flash',
    deepseek: 'deepseek-chat',
    groq: 'llama-3.3-70b-versatile',
    nvidia: 'meta/llama-3.1-8b-instruct'
  };
  return models[provider] || 'gpt-4o';
}

module.exports = { generateAIResponse };
