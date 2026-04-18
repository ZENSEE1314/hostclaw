const express = require('express');
const { authenticate } = require('../middleware/auth');
const { checkPayment } = require('../middleware/payment');
const User = require('../models/user');
const Chat = require('../models/chat');
const { generateAIResponse } = require('../services/ai');

const router = express.Router();

// Extract phone number from WhatsApp JID (e.g. 628123456789@s.whatsapp.net -> 628123456789)
function phoneFromJid(from) {
  if (!from) return '';
  return String(from).split('@')[0].split(':')[0];
}

// Heuristic: detect "my name is X", "I'm X", "saya X", "nama saya X", "ini X"
function extractNameFromText(text) {
  if (!text) return '';
  const patterns = [
    /\bmy name is\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)(?:[.,!?\n]|$)/i,
    /\bi am\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)(?:[.,!?\n]|$)/i,
    /\bi'?m\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)(?:[.,!?\n]|$)/i,
    /\bthis is\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)(?:[.,!?\n]|$)/i,
    /\bnama\s+saya\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)(?:[.,!?\n]|$)/i,
    /\bsaya\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)(?:[.,!?\n]|$)/i,
    /\bini\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)(?:[.,!?\n]|$)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      // reject common false-positives
      if (name.length < 2 || /^(fine|good|great|here|back|sure|yes|no|ok|okay)$/i.test(name)) continue;
      return name;
    }
  }
  return '';
}

function isLidJid(from) {
  return /@lid$/i.test(from || '');
}

// Detect "I need to check / ask the manager" punt phrases in the AI reply — indicates the KB
// didn't cover the question, so we queue it for the owner to answer.
function isPuntReply(reply) {
  if (!reply) return false;
  const r = reply.toLowerCase();
  return (
    /check with (my |our |the )?(boss|manager|owner|team|colleague)/i.test(r) ||
    /confirm with (my |our |the )?(boss|manager|owner|team)/i.test(r) ||
    /get back to you/i.test(r) ||
    /let me (double[- ]?)?check/i.test(r) ||
    /reply (?:in a bit|shortly|later)/i.test(r) ||
    /\bfollow up\b/i.test(r) ||
    /i['\u2019]?ll ask/i.test(r)
  );
}

async function queuePendingFAQ(agent, userId, question, aiReply) {
  try {
    if (!agent || !agent.id) return;
    if (!isPuntReply(aiReply)) return;
    const q = String(question || '').trim();
    if (q.length < 3 || q.length > 500) return;

    const Agent = require('../models/agent');
    const fresh = await Agent.findById(agent.id, userId);
    if (!fresh) return;

    let kb = [];
    if (fresh.knowledge_base) {
      kb = Array.isArray(fresh.knowledge_base) ? fresh.knowledge_base : JSON.parse(fresh.knowledge_base || '[]');
    }

    // Skip if an identical pending question already exists (case/whitespace-insensitive)
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const already = kb.some(e =>
      (e.type === 'pending_faq' || e.type === 'faq') &&
      (norm(e.title) === norm(q) || norm(e.question) === norm(q))
    );
    if (already) return;

    kb.push({
      type: 'pending_faq',
      title: q,
      content: '',
      keywords: [],
      created_at: new Date().toISOString()
    });

    await Agent.update(agent.id, userId, { knowledge_base: kb });
  } catch (e) {
    console.error('queuePendingFAQ error:', e.message);
  }
}

// E.164 international country code → country
const COUNTRY_CODES = [
  ['1',   'US/Canada'], ['7',   'Russia/Kazakhstan'],
  ['20',  'Egypt'], ['27',  'South Africa'], ['30',  'Greece'], ['31',  'Netherlands'],
  ['32',  'Belgium'], ['33',  'France'], ['34',  'Spain'], ['36',  'Hungary'],
  ['39',  'Italy'], ['40',  'Romania'], ['41',  'Switzerland'], ['44',  'United Kingdom'],
  ['45',  'Denmark'], ['46',  'Sweden'], ['47',  'Norway'], ['48',  'Poland'],
  ['49',  'Germany'], ['51',  'Peru'], ['52',  'Mexico'], ['54',  'Argentina'],
  ['55',  'Brazil'], ['56',  'Chile'], ['57',  'Colombia'], ['58',  'Venezuela'],
  ['60',  'Malaysia'], ['61',  'Australia'], ['62',  'Indonesia'], ['63',  'Philippines'],
  ['64',  'New Zealand'], ['65',  'Singapore'], ['66',  'Thailand'], ['81',  'Japan'],
  ['82',  'South Korea'], ['84',  'Vietnam'], ['86',  'China'], ['90',  'Turkey'],
  ['91',  'India'], ['92',  'Pakistan'], ['93',  'Afghanistan'], ['94',  'Sri Lanka'],
  ['95',  'Myanmar'], ['98',  'Iran'], ['212', 'Morocco'], ['213', 'Algeria'],
  ['216', 'Tunisia'], ['234', 'Nigeria'], ['254', 'Kenya'], ['255', 'Tanzania'],
  ['351', 'Portugal'], ['352', 'Luxembourg'], ['353', 'Ireland'], ['358', 'Finland'],
  ['380', 'Ukraine'], ['420', 'Czech Republic'], ['421', 'Slovakia'], ['852', 'Hong Kong'],
  ['853', 'Macau'], ['855', 'Cambodia'], ['856', 'Laos'], ['880', 'Bangladesh'],
  ['886', 'Taiwan'], ['960', 'Maldives'], ['961', 'Lebanon'], ['962', 'Jordan'],
  ['963', 'Syria'], ['964', 'Iraq'], ['965', 'Kuwait'], ['966', 'Saudi Arabia'],
  ['967', 'Yemen'], ['968', 'Oman'], ['971', 'UAE'], ['972', 'Israel'], ['974', 'Qatar'],
  ['976', 'Mongolia'], ['977', 'Nepal'], ['995', 'Georgia']
];

function detectCountry(phoneDigits) {
  if (!phoneDigits) return '';
  // Longest prefix wins
  const sorted = [...COUNTRY_CODES].sort((a, b) => b[0].length - a[0].length);
  for (const [code, country] of sorted) {
    if (phoneDigits.startsWith(code)) return country;
  }
  return '';
}

async function upsertWhatsAppContact(userId, from, text, pushName = '', senderPn = '', participantPn = '') {
  try {
    const { query } = require('../config/database');
    const u = await User.findById(userId);
    if (!u) return;
    let contacts = [];
    if (u.contacts) {
      contacts = Array.isArray(u.contacts) ? u.contacts : JSON.parse(u.contacts || '[]');
    }
    // Phone resolution:
    //   - Prefer senderPn / participantPn (Baileys passes these for @lid messages)
    //   - Fall back to JID prefix for normal @s.whatsapp.net
    const isLid = isLidJid(from);
    const pnDigits = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const phoneFromPn = pnDigits(senderPn) || pnDigits(participantPn);
    const phone = phoneFromPn || (isLid ? '' : phoneFromJid(from));
    const country = detectCountry(phone);
    let contact = contacts.find(c => c.platform === 'whatsapp' && c.platform_id === from);
    const extractedName = extractNameFromText(text);

    // Pick the best display name we have, in preference order:
    // 1. Name the customer explicitly states in the chat
    // 2. WhatsApp pushName (their profile name)
    // 3. Phone number (if available)
    // 4. Fallback "WhatsApp User"
    const bestName = extractedName || (pushName || '').trim() || phone || 'WhatsApp User';

    if (!contact) {
      const crypto = require('crypto');
      contact = {
        id: crypto.randomUUID(),
        name: bestName,
        phone: phone ? `+${phone}` : '',
        country: country || '',
        email: '',
        platform: 'whatsapp',
        platform_id: from,
        push_name: pushName || '',
        group: 'general',
        tags: [],
        created_at: new Date().toISOString()
      };
      contacts.push(contact);
    } else {
      // Upgrade name if current is weaker (phone/blank/LID) and we have something better
      const isWeakName = !contact.name
        || contact.name === contact.phone
        || /^\d+$/.test(contact.name)
        || contact.name === 'WhatsApp User';
      if (extractedName) {
        contact.name = extractedName;
      } else if (isWeakName && pushName) {
        contact.name = pushName;
      }
      if (pushName) contact.push_name = pushName;
      if (!contact.phone && phone) contact.phone = `+${phone}`;
      if (!contact.country && country) contact.country = country;
    }

    await query(
      'UPDATE users SET contacts = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(contacts), userId]
    );
  } catch (e) {
    console.error('upsertWhatsAppContact error:', e.message);
  }
}

// WhatsApp VPS webhook — public, called by the Baileys bridge without a JWT.
// Must be declared before router.use(authenticate) so it bypasses auth.
router.post('/whatsapp-webhook', async (req, res) => {
  try {
    const { userId, from, text, pushName = '', senderPn = '', participantPn = '' } = req.body;
    if (!userId || !text) return res.status(400).json({ error: 'userId and text required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!User.canSendMessage(user)) {
      return res.json({ reply: 'Message limit reached. Upgrade at chatsai.app' });
    }
    const deducted = await User.deductMessage(userId);
    if (!deducted) return res.json({ reply: 'Message limit reached.' });

    // CRM: auto-create/update contact from this message
    await upsertWhatsAppContact(userId, from, text, pushName, senderPn, participantPn);

    const sessionId = `whatsapp_${from}`;
    await Chat.saveMessage({ user_id: userId, session_id: sessionId, role: 'user', content: text });

    const Agent = require('../models/agent');
    const chatHistory = await Chat.getSessionHistory(userId, sessionId, 10);
    const agent = await Agent.findDefaultForUser(userId);

    const providers = typeof user.api_providers === 'string' ? JSON.parse(user.api_providers || '{}') : (user.api_providers || {});
    const defProv = user.default_provider || 'ollama';
    const providerConfig = providers[defProv] || providers[Object.keys(providers)[0]] || { model: 'gemma4:31b-cloud' };

    const aiRes = await generateAIResponse({
      message: text,
      provider: defProv,
      providerConfig,
      skills: [],
      chatHistory,
      agent
    });

    await Chat.saveMessage({ user_id: userId, session_id: sessionId, role: 'assistant', content: aiRes.content, model: aiRes.model, tokens: aiRes.tokens });

    // If the AI punted ("let me check with the manager"), queue the customer's question as a pending FAQ
    // so the owner can fill in the real answer from the dashboard.
    await queuePendingFAQ(agent, userId, text, aiRes.content);

    res.json({ reply: aiRes.content, model: aiRes.model });
  } catch (error) {
    console.error('WhatsApp VPS webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// All other chat routes require auth + payment
router.use(authenticate);
router.use(checkPayment);

// Get chat history
router.get('/history', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const messages = await Chat.getChatHistory(req.user.userId, limit);
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

// Send message and get AI response
router.post('/message', async (req, res, next) => {
  try {
    const { message, sessionId, provider: requestedProvider, model: requestedModel } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log('Chat message from user:', req.user.userId);

    // Get user with their configured providers and skills
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User found:', user.id, 'Credits:', user.credits, 'Has paid:', user.has_paid);
    
    // Credits check is handled by checkPayment middleware above
    // Users with own API keys bypass the credit requirement

    // Get user's active skills
    let activeSkills = [];
    try {
      activeSkills = (user.skills || []).filter(s => s.active).map(s => s.id);
    } catch (e) {
      console.log('No skills configured');
    }
    
    // Resolve provider: use requested provider, fall back to user's default
    let allProviders = {};
    if (user.api_providers) {
      allProviders = typeof user.api_providers === 'string'
        ? JSON.parse(user.api_providers)
        : user.api_providers;
    }

    // Pick the provider: requested > default > first available
    const defaultProvider = user.default_provider || 'openai';
    const resolvedProvider = (requestedProvider && allProviders[requestedProvider])
      ? requestedProvider
      : (allProviders[defaultProvider] ? defaultProvider : Object.keys(allProviders)[0]);

    let providerConfig = resolvedProvider ? allProviders[resolvedProvider] : null;

    console.log('Using provider:', resolvedProvider, 'Config exists:', !!providerConfig);

    if (!providerConfig) {
      return res.status(400).json({
        error: 'No AI provider configured',
        message: 'Please add your API key in Settings first',
        setup_url: '/settings.html'
      });
    }

    // Allow model override from request
    if (requestedModel) {
      providerConfig = { ...providerConfig, model: requestedModel };
    }

    // Save user message
    try {
      await Chat.saveMessage({
        user_id: req.user.userId,
        session_id: sessionId || 'default',
        role: 'user',
        content: message
      });
    } catch (e) {
      console.error('Failed to save message:', e.message);
    }
    
    // Fetch conversation history + agent for context
    const chatHistory = await Chat.getSessionHistory(req.user.userId, sessionId || 'default', 10);
    const Agent = require('../models/agent');
    const agent = await Agent.findDefaultForUser(req.user.userId);

    // Determine which AI service to use
    let aiResponse;
    try {
      aiResponse = await generateAIResponse({
        message,
        provider: resolvedProvider,
        providerConfig,
        skills: activeSkills,
        chatHistory,
        agent
      });
    } catch (aiError) {
      console.error('AI generation error:', aiError);
      return res.status(500).json({
        error: 'AI service error',
        message: aiError.message
      });
    }

    // Deduct message (new message-based billing)
    try {
      await User.deductMessage(req.user.userId);
    } catch (e) {
      console.error('Failed to deduct message:', e.message);
    }

    // Save AI response
    try {
      await Chat.saveMessage({
        user_id: req.user.userId,
        session_id: sessionId || 'default',
        role: 'assistant',
        content: aiResponse.content,
        model: aiResponse.model,
        tokens: aiResponse.tokens
      });
    } catch (e) {
      console.error('Failed to save AI response:', e.message);
    }

    res.json({
      message: aiResponse.content,
      model: aiResponse.model,
      tokens: aiResponse.tokens,
      content: aiResponse.content,
      response: aiResponse.content
    });
  } catch (error) {
    console.error('Chat message error:', error);
    res.status(500).json({ 
      error: 'Server error', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Manual reply — user takes over chat (sends as human, not AI)
router.post('/reply', async (req, res, next) => {
  try {
    const { session_id, message } = req.body;
    if (!session_id || !message) {
      return res.status(400).json({ error: 'session_id and message are required' });
    }

    // Save as 'operator' role so it's distinguishable from AI
    await Chat.saveMessage({
      user_id: req.user.userId,
      session_id,
      role: 'assistant',
      content: message,
      model: 'human'
    });

    // Send to the platform
    const platform = session_id.split('_')[0]; // e.g. 'telegram' from 'telegram_12345'
    const platformId = session_id.replace(`${platform}_`, '');

    if (platform === 'telegram') {
      const user = await User.findById(req.user.userId);
      const platforms = typeof user.platforms === 'string' ? JSON.parse(user.platforms || '{}') : (user.platforms || {});
      const tg = platforms.telegram;
      if (tg?.bot_token) {
        const axios = require('axios');
        const token = Buffer.from(tg.bot_token, 'base64').toString();
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: platformId,
          text: message
        }).catch(e => console.error('Telegram send error:', e.message));
      }
    } else if (platform === 'whatsapp') {
      // Relay to local Baileys bridge
      const axios = require('axios');
      const bridgeUrl = process.env.WA_VPS_URL || 'http://localhost:3001';
      await axios.post(`${bridgeUrl}/session/${req.user.userId}/send`, {
        to: platformId,
        text: message
      }, { timeout: 15000 }).catch(e => console.error('WhatsApp send error:', e.message));
    }

    res.json({ sent: true });
  } catch (error) { next(error); }
});

// Toggle bot on/off for a specific chat
router.post('/bot-toggle', async (req, res, next) => {
  try {
    const { session_id, paused } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    await Chat.setBotPaused(req.user.userId, session_id, !!paused);
    res.json({ paused: !!paused, session_id });
  } catch (error) { next(error); }
});

// Check bot status for a chat
router.get('/bot-status/:sessionId', async (req, res, next) => {
  try {
    const paused = await Chat.isBotPaused(req.user.userId, req.params.sessionId);
    res.json({ paused });
  } catch (error) { next(error); }
});

// Clear chat history
router.delete('/history', async (req, res, next) => {
  try {
    await Chat.clearChatHistory(req.user.userId);
    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    next(error);
  }
});


module.exports = router;
