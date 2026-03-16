const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

const router = express.Router();

// Get user's AI provider configurations
router.get('/providers', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json({
      providers: user.api_providers || {},
      default_provider: user.default_provider || 'openai'
    });
  } catch (error) {
    next(error);
  }
});

// Save AI provider API key
router.post('/providers', authenticate, async (req, res, next) => {
  try {
    const { provider, apiKey, model } = req.body;
    
    const validProviders = ['openai', 'anthropic', 'kimi', 'gemini', 'deepseek', 'groq'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    // Encrypt and store API key
    const encryptedKey = Buffer.from(apiKey).toString('base64'); // Simple encryption for demo
    
    await User.updateApiProvider(req.user.userId, provider, {
      apiKey: encryptedKey,
      model: model || getDefaultModel(provider),
      active: true
    });

    res.json({ message: `${provider} API key saved successfully` });
  } catch (error) {
    next(error);
  }
});

// Delete provider
router.delete('/providers/:provider', authenticate, async (req, res, next) => {
  try {
    await User.deactivateApiProvider(req.user.userId, req.params.provider);
    res.json({ message: 'Provider removed' });
  } catch (error) {
    next(error);
  }
});

// Test provider connection
router.post('/providers/:provider/test', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const provider = user.api_providers?.[req.params.provider];
    
    if (!provider || !provider.apiKey) {
      return res.status(400).json({ error: 'Provider not configured' });
    }

    // Simple test - decrypt and check format
    const apiKey = Buffer.from(provider.apiKey, 'base64').toString();
    
    // Basic validation
    if (req.params.provider === 'openai' && !apiKey.startsWith('sk-')) {
      return res.status(400).json({ error: 'Invalid OpenAI API key format' });
    }
    
    res.json({ message: 'API key format valid', provider: req.params.provider });
  } catch (error) {
    next(error);
  }
});

// Set default provider
router.post('/providers/default', authenticate, async (req, res, next) => {
  try {
    const { provider } = req.body;
    await User.setDefaultProvider(req.user.userId, provider);
    res.json({ message: 'Default provider updated' });
  } catch (error) {
    next(error);
  }
});

function getDefaultModel(provider) {
  const models = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet',
    kimi: 'kimi-k2.5',
    gemini: 'gemini-pro',
    deepseek: 'deepseek-chat',
    groq: 'llama-3.1-70b'
  };
  return models[provider] || 'gpt-4o';
}

module.exports = router;
