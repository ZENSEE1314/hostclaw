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
    const { message, sessionId } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get user with their configured providers and skills
    const user = await User.findById(req.user.userId);
    
    // Check credits
    if (user.credits <= 0) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        message: 'Please add credits to continue using the chat',
        credits: user.credits
      });
    }

    // Save user message
    await Chat.saveMessage({
      user_id: req.user.userId,
      session_id: sessionId || 'default',
      role: 'user',
      content: message
    });

    // Get user's active skills
    const activeSkills = (user.skills || []).filter(s => s.active).map(s => s.id);
    
    // Get user's preferred AI provider
    const defaultProvider = user.default_provider || 'openai';
    const providerConfig = user.api_providers?.[defaultProvider];
    
    // Determine which AI service to use
    let aiResponse;
    try {
      aiResponse = await generateAIResponse({
        message,
        provider: defaultProvider,
        providerConfig,
        skills: activeSkills,
        user
      });
    } catch (aiError) {
      console.error('AI generation error:', aiError);
      aiResponse = {
        content: 'Sorry, I encountered an error processing your request. Please check your API configuration or try again.',
        model: 'error',
        tokens: 0
      };
    }

    // Deduct credits based on tokens used
    const cost = calculateCost(aiResponse.tokens || 0, defaultProvider);
    await User.deductCredits(req.user.userId, cost);

    // Save AI response
    await Chat.saveMessage({
      user_id: req.user.userId,
      session_id: sessionId || 'default',
      role: 'assistant',
      content: aiResponse.content,
      model: aiResponse.model,
      tokens: aiResponse.tokens
    });

    res.json({
      message: aiResponse.content,
      model: aiResponse.model,
      tokens: aiResponse.tokens,
      cost: cost,
      remaining_credits: user.credits - cost,
      skills_used: aiResponse.skillsUsed || []
    });
  } catch (error) {
    next(error);
  }
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
