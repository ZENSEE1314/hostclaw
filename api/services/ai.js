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

// Generate AI response using user's configured provider
async function generateAIResponse({ message, provider, providerConfig, skills }) {
  if (!providerConfig || !providerConfig.apiKey) {
    return {
      content: '⚠️ No AI provider configured. Please add your API keys in Settings.',
      model: 'none',
      tokens: 0
    };
  }

  // Decrypt the API key
  let decryptedKey;
  try {
    decryptedKey = decrypt(providerConfig.apiKey);
  } catch (e) {
    console.error('Failed to decrypt API key:', e.message);
    return {
      content: '⚠️ Failed to decrypt API key. Please re-save your API key in Settings.',
      model: 'none',
      tokens: 0
    };
  }

  const model = providerConfig.model || getDefaultModel(provider);

  try {
    switch (provider) {
      case 'openai':
        return await callOpenAI(message, decryptedKey, model, skills);
      
      case 'anthropic':
        return await callAnthropic(message, decryptedKey, model, skills);
      
      case 'kimi':
        return await callKimi(message, decryptedKey, model, skills);
      
      case 'gemini':
        return await callGemini(message, decryptedKey, model, skills);
      
      case 'deepseek':
        return await callDeepSeek(message, decryptedKey, model, skills);
      
      case 'groq':
        return await callGroq(message, decryptedKey, model, skills);
      
      case 'nvidia':
        return await callNVIDIA(message, decryptedKey, model, skills);
      
      default:
        return {
          content: 'Unsupported provider: ' + provider,
          model: 'none',
          tokens: 0
        };
    }
  } catch (error) {
    console.error(`Error calling ${provider}:`, error.message);
    const status = error.response?.status || error.status;
    let userMessage;
    if (status === 401 || (error.message && error.message.includes('401'))) {
      userMessage = `⚠️ Invalid API key for ${provider}. Please go to **Settings** and re-enter your ${provider} API key.`;
    } else if (status === 429 || (error.message && error.message.includes('429'))) {
      userMessage = `⚠️ Rate limit reached for ${provider}. Wait a moment and try again.`;
    } else if (status === 402 || (error.message && error.message.includes('insufficient_quota'))) {
      userMessage = `⚠️ Your ${provider} account has no remaining quota/credits. Please top up your ${provider} account.`;
    } else if (status === 404) {
      userMessage = `⚠️ Model not found for ${provider}. Please go to **Settings** and select a different model.`;
    } else {
      userMessage = `⚠️ ${provider} error: ${error.message}`;
    }
    return {
      content: userMessage,
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
    }
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
    groq: 'llama-3.1-70b-versatile',
    nvidia: 'meta/llama-3.1-8b-instruct'
  };
  return models[provider] || 'gpt-4o';
}

module.exports = { generateAIResponse };
