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

// ChatsAI shared API keys — fallback when user has no keys configured
// Checks both HOSTCLAW_*_KEY and standard env var names (OPENAI_API_KEY, etc.)
function getChatsAIKey(provider) {
  const map = {
    openai: process.env.HOSTCLAW_OPENAI_KEY || process.env.OPENAI_API_KEY,
    anthropic: process.env.HOSTCLAW_ANTHROPIC_KEY || process.env.HOSTCLAW_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY,
    kimi: process.env.HOSTCLAW_KIMI_KEY || process.env.KIMI_API_KEY,
    gemini: process.env.HOSTCLAW_GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY,
    deepseek: process.env.HOSTCLAW_DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY,
    groq: process.env.HOSTCLAW_GROQ_KEY || process.env.GROQ_API_KEY,
    nvidia: process.env.HOSTCLAW_NVIDIA_KEY || process.env.NVIDIA_API_KEY,
    ollama: 'ollama'
  };
  return map[provider] || null;
}

// Generate AI response using user's configured provider or ChatsAI fallback
async function generateAIResponse({ message, provider, providerConfig, skills, chatHistory = [], agent = null }) {
  // openclaw is server-hosted — no API key needed
  if (provider === 'openclaw') {
    return callOpenClaw(message, skills);
  }

  // Resolve the API key: user's key first, then ChatsAI fallback
  let decryptedKey = null;
  let resolvedProvider = provider;
  let resolvedModel = providerConfig?.model;

  if (providerConfig?.apiKey) {
    // User has their own key — decrypt it
    try {
      decryptedKey = decrypt(providerConfig.apiKey);
    } catch (e) {
      console.error('Failed to decrypt user API key:', e.message);
      // Fall through to ChatsAI key
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
    for (const p of ['ollama', 'groq', 'deepseek', 'openai', 'anthropic', 'gemini', 'kimi', 'nvidia']) {
      if (!searchOrder.includes(p)) searchOrder.push(p);
    }

    for (const p of searchOrder) {
      const key = getChatsAIKey(p);
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
  const result = await callProvider(resolvedProvider, decryptedKey, model, message, skills, chatHistory, agent);
  if (!result.error) return result;

  // Primary provider failed — try fallback providers
  console.log(`Primary provider ${resolvedProvider} failed: ${result.content}. Trying fallbacks...`);
  const fallbackOrder = ['ollama', 'groq', 'deepseek', 'openai', 'anthropic', 'gemini', 'kimi', 'nvidia'];
  for (const p of fallbackOrder) {
    if (p === resolvedProvider) continue;
    const key = getChatsAIKey(p);
    if (!key) continue;
    console.log(`Trying fallback provider: ${p}`);
    const fallbackResult = await callProvider(p, key, getDefaultModel(p), message, skills, chatHistory, agent);
    if (!fallbackResult.error) return fallbackResult;
    console.log(`Fallback ${p} also failed: ${fallbackResult.content}`);
  }

  // All providers failed
  return result;
}

async function callProvider(provider, apiKey, model, message, skills, chatHistory = [], agent = null) {
  try {
    const callers = {
      openai: callOpenAI,
      anthropic: callAnthropic,
      kimi: callKimi,
      gemini: callGemini,
      deepseek: callDeepSeek,
      groq: callGroq,
      nvidia: callNVIDIA,
      ollama: callOllama,
      openclaw: (msg, key, mdl, sk) => callOpenClaw(msg, sk)
    };
    const fn = callers[provider];
    if (!fn) return { content: 'Unsupported provider: ' + provider, model: 'none', tokens: 0, error: true };
    return await fn(message, apiKey, model, skills, chatHistory, agent);
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

async function callOpenAI(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const openai = new OpenAI({ apiKey });

  const messages = [
    { role: 'system', content: buildSystemPrompt({ skills, agent }) },
    ...chatHistory.map(m => ({ role: m.role, content: m.content })),
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

async function callAnthropic(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: model,
    max_tokens: 2000,
    system: buildSystemPrompt({ skills, agent }),
    messages: [
      ...chatHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ]
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

async function callKimi(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const response = await axios.post('https://api.moonshot.cn/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt({ skills, agent }) },
      ...chatHistory.map(m => ({ role: m.role, content: m.content })),
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

async function callGemini(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const historyText = chatHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const fullPrompt = buildSystemPrompt({ skills, agent }) + '\n\n' + (historyText ? historyText + '\n' : '') + 'User: ' + message;
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { contents: [{ parts: [{ text: fullPrompt }] }] }
  );

  const text = response.data.candidates[0].content.parts[0].text;
  return {
    content: text,
    model: model,
    tokens: estimateTokens(message + text)
  };
}

async function callDeepSeek(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt({ skills, agent }) },
      ...chatHistory.map(m => ({ role: m.role, content: m.content })),
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

async function callGroq(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt({ skills, agent }) },
      ...chatHistory.map(m => ({ role: m.role, content: m.content })),
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

async function callNVIDIA(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt({ skills, agent }) },
      ...chatHistory.map(m => ({ role: m.role, content: m.content })),
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

async function callOllama(message, apiKey, model, skills, chatHistory = [], agent = null) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

  const response = await axios.post(`${ollamaUrl}/v1/chat/completions`, {
    model: model,
    messages: [
      { role: 'system', content: buildSystemPrompt({ skills, agent }) },
      ...chatHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ],
    temperature: 0.7,
    max_tokens: 2000
  }, {
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'
    },
    timeout: 60000
  });

  return {
    content: response.data.choices[0].message.content,
    model: response.data.model || model,
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
  return openclawService.chat(message, buildSystemPrompt({ skills }));
}

function buildSystemPrompt({ skills = [], agent = null } = {}) {
  const botType = agent?.bot_type || 'personal';
  const businessName = agent?.business_name || 'our company';
  const customPrompt = agent?.system_prompt;
  const kb = agent?.knowledge_base || [];

  let prompt = '';

  // Use custom system prompt if provided, else generate based on bot type
  if (customPrompt) {
    prompt = customPrompt + '\n\n';
  } else {
    switch (botType) {
      case 'customer_service':
        prompt = `You help customers of ${businessName} over chat. Reply like a real person texting on WhatsApp: short, casual, warm, and human. Use the knowledge base below to answer accurately. If something isn't in there, just say you'll check — don't make things up.\n\n`;
        break;

      case 'sales':
        prompt = `You chat with potential customers of ${businessName} over WhatsApp. Understand what they want, suggest relevant options, and help them decide. Be helpful and honest, not pushy.\n\n`;
        break;

      default: // personal
        prompt = `You are a helpful personal AI assistant. Match the user's language and tone. Be friendly, concise, conversational.\n\n`;
        break;
    }
  }

  // Chat-style guidance for ALL bot types (applies to custom prompts too)
  prompt += `--- STYLE RULES ---\n` +
    `This is a real chat conversation (like WhatsApp/Telegram), NOT an email. Follow these rules strictly:\n` +
    `- GREETINGS: Only greet on the VERY FIRST message of a conversation. If the chat history above already contains any prior assistant reply, DO NOT greet again — jump straight to answering. Never say "Hello", "Hi", "Thank you for contacting us", "Good day" on any message after the first.\n` +
    `- SIGN-OFFS: NEVER sign off with "Best regards", "Sincerely", "Customer Service Representative", "Let me know if you need anything else", or any closing line. Just end the reply where the content ends.\n` +
    `- LENGTH: Keep replies SHORT — 1-3 sentences usually, one short paragraph at most.\n` +
    `- NEVER repeat the same template wording on every message. Each reply should feel fresh and in the flow.\n` +
    `- Don't use bullet points or markdown headers unless the user explicitly asks for a list.\n` +
    `- Use the customer's name naturally ONCE in a while if you know it — don't start every single reply with their name.\n` +
    `- Match the customer's language (English, Indonesian, Malay, etc.) and match their level of formality.\n\n`;

  // CRM capture guidance for business bots
  if (botType === 'customer_service' || botType === 'sales') {
    prompt += `--- CRM GUIDANCE ---\n` +
      `If you don't know the customer's name yet, ask for it naturally within the first 1-2 replies (e.g. "What's your name?" or "Who am I chatting with?"). Ask once, politely. If they decline, drop it and carry on.\n\n`;
  }

  // Inject knowledge base content by type
  if (kb.length > 0) {
    // Business info
    const bizInfo = kb.filter(i => i.type === 'business_info');
    if (bizInfo.length > 0) {
      prompt += '--- BUSINESS INFORMATION ---\n';
      for (const b of bizInfo) {
        if (b.title) prompt += `Company Name: ${b.title}\n`;
        if (b.industry) prompt += `Industry: ${b.industry}\n`;
        if (b.description) prompt += `About Us: ${b.description}\n`;
        if (b.address) prompt += `Address: ${b.address}\n`;
        if (b.hours) prompt += `Opening Hours: ${b.hours}\n`;
        if (b.email) prompt += `Email: ${b.email}\n`;
        if (b.phone) prompt += `Phone: ${b.phone}\n`;
        if (b.website) prompt += `Website: ${b.website}\n`;
      }
      prompt += '\n';
    }

    // Products
    const products = kb.filter(i => i.type === 'product');
    if (products.length > 0) {
      prompt += '--- PRODUCTS & SERVICES ---\n';
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        prompt += `${i + 1}. ${p.title}\n`;
        if (p.content) prompt += `   ${p.content}\n`;
        if (p.packages && p.packages.length > 0) {
          prompt += '   Pricing:\n';
          for (const pkg of p.packages) {
            prompt += `   - ${pkg.name}: ${pkg.price}${pkg.details ? ' (' + pkg.details + ')' : ''}\n`;
          }
        } else if (p.price) {
          prompt += `   Price: ${p.price}\n`;
        }
        if (p.images && p.images.length > 0) prompt += `   (${p.images.length} images available)\n`;
        if (p.video) prompt += `   (Video available)\n`;
        prompt += '\n';
      }
    }

    // FAQs
    const faqs = kb.filter(i => i.type === 'faq');
    if (faqs.length > 0) {
      prompt += '--- FREQUENTLY ASKED QUESTIONS ---\n';
      for (const f of faqs) {
        prompt += `Q: ${f.title}\nA: ${f.content}\n`;
        if (f.keywords && f.keywords.length > 0) prompt += `(Keywords: ${f.keywords.join(', ')})\n`;
        prompt += '\n';
      }
    }

    // Booking config
    const bookingConfig = kb.find(i => i.type === 'booking_config');
    if (bookingConfig) {
      prompt += '--- BOOKING SYSTEM ---\n';
      prompt += `Available: ${(bookingConfig.available_days || []).join(', ')} from ${bookingConfig.available_hours || '9:00-18:00'}\n`;
      prompt += `Slot duration: ${bookingConfig.slot_duration || 60} minutes\n`;
      if (bookingConfig.content) prompt += `Instructions: ${bookingConfig.content}\n`;

      // Inject current bookings so AI knows which slots are taken
      const bookings = agent?.bookings || [];
      if (Array.isArray(bookings) && bookings.length > 0) {
        const upcoming = bookings.filter(b => b.status === 'confirmed' && new Date(b.date + 'T' + b.time) >= new Date());
        if (upcoming.length > 0) {
          prompt += 'BOOKED SLOTS (unavailable):\n';
          for (const bk of upcoming) {
            prompt += `- ${bk.date} at ${bk.time} (${bk.customer_name})\n`;
          }
        }
      }
      prompt += 'When customer wants to book: ask for preferred date, time, name, and phone number. ';
      prompt += 'If the slot is already booked, suggest the next available time.\n';
      prompt += 'To confirm a booking, reply with: BOOKING_CONFIRM:{date}|{time}|{name}|{phone}\n\n';
    }

    // Personal profile
    const profile = kb.find(i => i.type === 'user_profile');
    if (profile) {
      prompt += '--- ABOUT THE USER YOU REPRESENT ---\n';
      if (profile.name) prompt += `Name: ${profile.name}\n`;
      if (profile.dob) prompt += `Date of Birth: ${profile.dob}\n`;
      if (profile.hobbies) prompt += `Hobbies: ${profile.hobbies}\n`;
      if (profile.personality) prompt += `Communication Style: ${profile.personality}\n`;
      if (profile.content) prompt += `Notes: ${profile.content}\n`;
      prompt += 'Reply as this person would. Match their tone, language, slang, and personality.\n\n';
    }

    // Conversation samples
    const samples = kb.filter(i => i.type === 'conversation_sample');
    if (samples.length > 0) {
      prompt += '--- CONVERSATION SAMPLES (learn this style) ---\n';
      for (const s of samples) {
        prompt += `[Chat with ${s.person || s.title}]:\n`;
        prompt += s.content.substring(0, 3000) + '\n\n';
      }
      prompt += 'Study these conversations. Reply in the SAME style, tone, and language pattern.\n\n';
    }

    // Generic/custom entries
    const custom = kb.filter(i => !['product', 'faq', 'business_info', 'booking_config', 'user_profile', 'conversation_sample'].includes(i.type));
    if (custom.length > 0) {
      prompt += '--- ADDITIONAL INFORMATION ---\n';
      for (const c of custom) {
        prompt += `${c.title}: ${c.content}\n\n`;
      }
    }

    prompt += 'Use all the information above to answer questions accurately. ';
  }

  // Add skills info
  if (skills.length > 0) {
    prompt += `Available skills: ${skills.join(', ')}. `;
  }

  prompt += 'Keep responses concise and helpful.';
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
    nvidia: 'meta/llama-3.1-8b-instruct',
    ollama: process.env.OLLAMA_MODEL || 'gemma4:31b-cloud'
  };
  return models[provider] || 'gpt-4o';
}

module.exports = { generateAIResponse };
