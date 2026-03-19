const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const crypto = require('crypto');

const router = express.Router();

// Simple encryption for API keys (in production, use proper key management)
function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    // Ensure key is exactly 32 bytes for AES-256
    const key = Buffer.from(envKey);
    if (key.length === 32) return key;
    // If not 32 bytes, hash it to get 32 bytes
    return crypto.createHash('sha256').update(envKey).digest();
  }
  // Default key (only for development!)
  return crypto.createHash('sha256').update('hostclaw-default-key-change-in-production').digest();
}

function encrypt(text) {
  const algorithm = 'aes-256-cbc';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// Save provider API key
router.post('/', authenticate, async (req, res) => {
  try {
    const { provider, apiKey, model } = req.body;
    
    console.log('Save provider request:', { provider, model, userId: req.user.userId });
    
    if (!provider || !apiKey) {
      return res.status(400).json({ error: 'Provider and API key required' });
    }
    
    // Get current user
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('User found:', user.id);
    
    // Parse existing providers
    let providers = {};
    if (user.api_providers) {
      try {
        providers = typeof user.api_providers === 'string' 
          ? JSON.parse(user.api_providers) 
          : user.api_providers;
      } catch (e) {
        console.log('Failed to parse providers, starting fresh');
        providers = {};
      }
    }
    
    console.log('Current providers:', Object.keys(providers));
    
    // Encrypt and save API key
    providers[provider] = {
      apiKey: encrypt(apiKey),
      model: model || getDefaultModel(provider),
      addedAt: new Date().toISOString()
    };
    
    console.log('Saving providers...');
    
    // Update user
    await User.updateProviders(req.user.userId, providers);
    
    console.log('Providers saved successfully');
    
    res.json({ 
      message: 'Provider saved successfully',
      provider: provider
    });
    
  } catch (error) {
    console.error('Save provider error:', error);
    res.status(500).json({ error: 'Failed to save provider: ' + error.message });
  }
});

// Set default provider
router.put('/default', authenticate, async (req, res) => {
  try {
    const { provider } = req.body;
    
    if (!provider) {
      return res.status(400).json({ error: 'Provider required' });
    }
    
    await User.updateDefaultProvider(req.user.userId, provider);
    
    res.json({ 
      message: 'Default provider updated',
      provider: provider
    });
    
  } catch (error) {
    console.error('Update default provider error:', error);
    res.status(500).json({ error: 'Failed to update default provider' });
  }
});

// Remove ALL providers
router.delete('/', authenticate, async (req, res) => {
  try {
    await User.updateProviders(req.user.userId, {});
    await User.updateDefaultProvider(req.user.userId, null);
    res.json({ message: 'All providers removed' });
  } catch (error) {
    console.error('Remove all providers error:', error);
    res.status(500).json({ error: 'Failed to remove providers' });
  }
});

// Remove a provider
router.delete('/:provider', authenticate, async (req, res) => {
  try {
    const { provider } = req.params;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let providers = {};
    if (user.api_providers) {
      providers = typeof user.api_providers === 'string'
        ? JSON.parse(user.api_providers)
        : user.api_providers;
    }

    delete providers[provider];
    await User.updateProviders(req.user.userId, providers);

    res.json({ message: 'Provider removed', provider });
  } catch (error) {
    console.error('Remove provider error:', error);
    res.status(500).json({ error: 'Failed to remove provider' });
  }
});

// Get user's providers (without API keys)
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    let providers = {};
    if (user.api_providers) {
      const allProviders = typeof user.api_providers === 'string' 
        ? JSON.parse(user.api_providers) 
        : user.api_providers;
      
      // Return only provider names and models, not API keys
      for (const [key, value] of Object.entries(allProviders)) {
        providers[key] = {
          model: value.model,
          addedAt: value.addedAt
        };
      }
    }
    
    res.json({
      providers: providers,
      defaultProvider: user.default_provider || null
    });
    
  } catch (error) {
    console.error('Get providers error:', error);
    res.status(500).json({ error: 'Failed to get providers' });
  }
});

function getDefaultModel(provider) {
  const defaults = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-latest',
    nvidia: 'nvidia/llama-3.1-nemotron-70b-instruct',
    gemini: 'gemini-1.5-flash',
    deepseek: 'deepseek-chat',
    groq: 'llama-3.1-70b-versatile',
    kimi: 'moonshot-v1-8k'
  };
  return defaults[provider] || 'gpt-4o';
}

module.exports = router;
