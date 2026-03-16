const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

const router = express.Router();

// Get user's connected platforms
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json({
      platforms: user.platforms || {}
    });
  } catch (error) {
    next(error);
  }
});

// Generate WhatsApp QR/link for connection
router.post('/whatsapp/connect', authenticate, async (req, res, next) => {
  try {
    // In production, this would generate a pairing code or QR session
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Store pending connection
    await User.updatePlatform(req.user.userId, 'whatsapp', {
      status: 'pending',
      pairing_code: pairingCode,
      created_at: new Date()
    });

    res.json({
      message: 'Use this code to connect WhatsApp',
      pairing_code: pairingCode,
      instructions: [
        'Open WhatsApp on your phone',
        'Go to Settings → Linked Devices',
        'Tap "Link a Device"',
        'Enter the pairing code above'
      ]
    });
  } catch (error) {
    next(error);
  }
});

// Connect Telegram bot
router.post('/telegram/connect', authenticate, async (req, res, next) => {
  try {
    const { botToken } = req.body;
    
    if (!botToken) {
      return res.status(400).json({ error: 'Bot token is required' });
    }

    // Validate token format
    if (!botToken.match(/^\d+:[A-Za-z0-9_-]{35}$/)) {
      return res.status(400).json({ error: 'Invalid bot token format' });
    }

    // In production, verify the token with Telegram API
    // const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    
    await User.updatePlatform(req.user.userId, 'telegram', {
      status: 'connected',
      bot_token: Buffer.from(botToken).toString('base64'),
      connected_at: new Date()
    });

    res.json({
      message: 'Telegram bot connected successfully',
      bot_username: 'your_bot_name', // Would get from Telegram API
      webhook_url: `${process.env.API_URL}/webhooks/telegram/${req.user.userId}`
    });
  } catch (error) {
    next(error);
  }
});

// Disconnect a platform
router.delete('/:platform', authenticate, async (req, res, next) => {
  try {
    const { platform } = req.params;
    
    if (!['whatsapp', 'telegram'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    await User.removePlatform(req.user.userId, platform);
    
    res.json({ message: `${platform} disconnected successfully` });
  } catch (error) {
    next(error);
  }
});

// Get connection status
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const platforms = user.platforms || {};
    
    res.json({
      whatsapp: {
        connected: platforms.whatsapp?.status === 'connected',
        phone_number: platforms.whatsapp?.phone_number || null,
        connected_at: platforms.whatsapp?.connected_at || null
      },
      telegram: {
        connected: platforms.telegram?.status === 'connected',
        bot_username: platforms.telegram?.bot_username || null,
        connected_at: platforms.telegram?.connected_at || null
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
