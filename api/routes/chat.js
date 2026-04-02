const express = require('express');
const { authenticate } = require('../middleware/auth');
const { checkPayment } = require('../middleware/payment');
const User = require('../models/user');
const Chat = require('../models/chat');
const { generateAIResponse } = require('../services/ai');

const router = express.Router();

// All chat routes require payment
router.use(authenticate);
router.use(checkPayment);

// Get chat history
router.get('/history', async (req, res, next) => {
  try {
    const messages = await Chat.getChatHistory(req.user.userId, 50);
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
    
    // Determine which AI service to use
    let aiResponse;
    try {
      aiResponse = await generateAIResponse({
        message,
        provider: resolvedProvider,
        providerConfig,
        skills: activeSkills
      });
    } catch (aiError) {
      console.error('AI generation error:', aiError);
      return res.status(500).json({
        error: 'AI service error',
        message: aiError.message
      });
    }

    // Deduct credits based on tokens used
    const cost = calculateCost(aiResponse.tokens || 0, resolvedProvider);
    
    try {
      await User.deductCredits(req.user.userId, cost);
    } catch (e) {
      console.error('Failed to deduct credits:', e.message);
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
      cost: cost,
      remaining_credits: user.credits - cost,
      skills_used: aiResponse.skillsUsed || []
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
    }
    // WhatsApp manual reply would need Baileys socket reference (complex)

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

function calculateCost(tokens, provider) {
  // Rough cost calculation per 1K tokens
  const rates = {
    openai: 0.03,
    anthropic: 0.03,
    kimi: 0.015,
    gemini: 0.005,
    deepseek: 0.002,
    groq: 0.005
  };
  
  const rate = rates[provider] || 0.03;
  return Math.max(0.01, (tokens / 1000) * rate);
}

module.exports = router;
