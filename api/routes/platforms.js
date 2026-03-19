const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const axios = require('axios');

const router = express.Router();

const VALID_PLATFORMS = ['whatsapp', 'telegram', 'discord', 'slack', 'line', 'messenger', 'signal', 'wechat'];

// Get user's connected platforms
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    let platforms = {};
    if (user.platforms) {
      platforms = typeof user.platforms === 'string' ? JSON.parse(user.platforms) : user.platforms;
    }
    res.json({ platforms });
  } catch (error) {
    next(error);
  }
});

// ===== WHATSAPP =====
router.post('/whatsapp/connect', authenticate, async (req, res, next) => {
  try {
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
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

// ===== TELEGRAM =====
router.post('/telegram/connect', authenticate, async (req, res, next) => {
  try {
    const { botToken } = req.body;
    
    if (!botToken) {
      return res.status(400).json({ error: 'Bot token is required' });
    }

    if (!botToken.match(/^\d+:[A-Za-z0-9_-]{30,50}$/)) {
      return res.status(400).json({ error: 'Invalid bot token format. Expected format: 123456789:ABCdef...' });
    }

    // Verify with Telegram API
    const telegramRes = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
    
    if (!telegramRes.data.ok) {
      return res.status(400).json({ error: 'Invalid bot token' });
    }

    const botInfo = telegramRes.data.result;
    
    await User.updatePlatform(req.user.userId, 'telegram', {
      status: 'connected',
      bot_token: Buffer.from(botToken).toString('base64'),
      bot_username: botInfo.username,
      bot_name: botInfo.first_name,
      connected_at: new Date()
    });

    // Set webhook
    const webhookUrl = `${process.env.API_URL}/webhooks/telegram/${req.user.userId}`;
    await axios.post(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      url: webhookUrl
    });

    res.json({
      message: 'Telegram bot connected successfully',
      bot_username: botInfo.username,
      bot_name: botInfo.first_name,
      webhook_url: webhookUrl
    });
  } catch (error) {
    console.error('Telegram connection error:', error);
    next(error);
  }
});

// ===== DISCORD =====
router.post('/discord/connect', authenticate, async (req, res, next) => {
  try {
    const { botToken } = req.body;
    
    if (!botToken) {
      return res.status(400).json({ error: 'Bot token is required' });
    }

    // Verify with Discord API
    const discordRes = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': `Bot ${botToken}` }
    });

    const botInfo = discordRes.data;
    
    await User.updatePlatform(req.user.userId, 'discord', {
      status: 'connected',
      bot_token: Buffer.from(botToken).toString('base64'),
      bot_username: botInfo.username,
      bot_id: botInfo.id,
      connected_at: new Date()
    });

    res.json({
      message: 'Discord bot connected successfully',
      bot_username: botInfo.username,
      bot_id: botInfo.id,
      invite_url: `https://discord.com/api/oauth2/authorize?client_id=${botInfo.id}&permissions=309237664768&scope=bot`
    });
  } catch (error) {
    console.error('Discord connection error:', error);
    res.status(400).json({ error: 'Invalid Discord bot token' });
  }
});

// ===== SLACK =====
router.post('/slack/connect', authenticate, async (req, res, next) => {
  try {
    const { botToken, signingSecret } = req.body;
    
    if (!botToken || !botToken.startsWith('xoxb-')) {
      return res.status(400).json({ error: 'Valid Bot User OAuth Token required (starts with xoxb-)' });
    }

    // Verify with Slack API
    const slackRes = await axios.get('https://slack.com/api/auth.test', {
      headers: { 'Authorization': `Bearer ${botToken}` }
    });

    if (!slackRes.data.ok) {
      return res.status(400).json({ error: 'Invalid Slack token' });
    }

    const teamInfo = await axios.get('https://slack.com/api/team.info', {
      headers: { 'Authorization': `Bearer ${botToken}` }
    });

    await User.updatePlatform(req.user.userId, 'slack', {
      status: 'connected',
      bot_token: Buffer.from(botToken).toString('base64'),
      signing_secret: signingSecret ? Buffer.from(signingSecret).toString('base64') : null,
      team_name: teamInfo.data.team?.name,
      team_id: slackRes.data.team_id,
      bot_user_id: slackRes.data.user_id,
      connected_at: new Date()
    });

    res.json({
      message: 'Slack workspace connected successfully',
      team_name: teamInfo.data.team?.name,
      team_id: slackRes.data.team_id
    });
  } catch (error) {
    console.error('Slack connection error:', error);
    res.status(400).json({ error: 'Failed to connect Slack' });
  }
});

// ===== LINE =====
router.post('/line/connect', authenticate, async (req, res, next) => {
  try {
    const { channelSecret, channelAccessToken } = req.body;
    
    if (!channelSecret || !channelAccessToken) {
      return res.status(400).json({ error: 'Channel secret and access token are required' });
    }

    // Verify with LINE API
    const lineRes = await axios.get('https://api.line.me/v2/bot/info', {
      headers: { 'Authorization': `Bearer ${channelAccessToken}` }
    });

    await User.updatePlatform(req.user.userId, 'line', {
      status: 'connected',
      channel_secret: Buffer.from(channelSecret).toString('base64'),
      channel_token: Buffer.from(channelAccessToken).toString('base64'),
      bot_name: lineRes.data.displayName,
      bot_id: lineRes.data.userId,
      connected_at: new Date()
    });

    res.json({
      message: 'LINE bot connected successfully',
      bot_name: lineRes.data.displayName,
      webhook_url: `${process.env.API_URL}/webhooks/line/${req.user.userId}`
    });
  } catch (error) {
    console.error('LINE connection error:', error);
    res.status(400).json({ error: 'Invalid LINE credentials' });
  }
});

// ===== MESSENGER (META) =====
router.post('/messenger/connect', authenticate, async (req, res, next) => {
  try {
    const { pageAccessToken, pageId, appSecret } = req.body;
    
    if (!pageAccessToken || !pageId) {
      return res.status(400).json({ error: 'Page access token and page ID are required' });
    }

    // Verify with Facebook Graph API
    const fbRes = await axios.get(`https://graph.facebook.com/v18.0/${pageId}?access_token=${pageAccessToken}`);

    await User.updatePlatform(req.user.userId, 'messenger', {
      status: 'connected',
      page_token: Buffer.from(pageAccessToken).toString('base64'),
      page_id: pageId,
      app_secret: appSecret ? Buffer.from(appSecret).toString('base64') : null,
      page_name: fbRes.data.name,
      connected_at: new Date()
    });

    res.json({
      message: 'Facebook Messenger connected successfully',
      page_name: fbRes.data.name,
      page_id: pageId
    });
  } catch (error) {
    console.error('Messenger connection error:', error);
    res.status(400).json({ error: 'Invalid Facebook credentials' });
  }
});

// ===== SIGNAL (Simple-Bridge) =====
router.post('/signal/connect', authenticate, async (req, res, next) => {
  try {
    const { phoneNumber, signalCliRestApiUrl } = req.body;
    
    if (!phoneNumber || !signalCliRestApiUrl) {
      return res.status(400).json({ error: 'Phone number and Signal CLI REST API URL are required' });
    }

    // Verify Signal CLI connection
    const signalRes = await axios.get(`${signalCliRestApiUrl}/v1/about`);

    await User.updatePlatform(req.user.userId, 'signal', {
      status: 'connected',
      phone_number: phoneNumber,
      api_url: signalCliRestApiUrl,
      connected_at: new Date()
    });

    res.json({
      message: 'Signal connected successfully',
      phone_number: phoneNumber,
      signal_version: signalRes.data.version
    });
  } catch (error) {
    console.error('Signal connection error:', error);
    res.status(400).json({ error: 'Failed to connect Signal. Make sure signal-cli-rest-api is running.' });
  }
});

// ===== WECHAT (Work/Official Account) =====
router.post('/wechat/connect', authenticate, async (req, res, next) => {
  try {
    const { appId, appSecret, token, encodingAesKey } = req.body;
    
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'App ID and App Secret are required' });
    }

    // Get access token to verify
    const wxRes = await axios.get(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`);

    if (wxRes.data.errcode) {
      return res.status(400).json({ error: 'Invalid WeChat credentials' });
    }

    await User.updatePlatform(req.user.userId, 'wechat', {
      status: 'connected',
      app_id: appId,
      app_secret: Buffer.from(appSecret).toString('base64'),
      token: token,
      encoding_aes_key: encodingAesKey,
      access_token: wxRes.data.access_token,
      connected_at: new Date()
    });

    res.json({
      message: 'WeChat Official Account connected successfully',
      app_id: appId,
      webhook_url: `${process.env.API_URL}/webhooks/wechat/${req.user.userId}`
    });
  } catch (error) {
    console.error('WeChat connection error:', error);
    res.status(400).json({ error: 'Failed to connect WeChat' });
  }
});

// Disconnect any platform
router.delete('/:platform', authenticate, async (req, res, next) => {
  try {
    const { platform } = req.params;
    
    if (!VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    await User.removePlatform(req.user.userId, platform);
    
    res.json({ message: `${platform} disconnected successfully` });
  } catch (error) {
    next(error);
  }
});

// Get connection status for all platforms
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    let platforms = {};
    if (user.platforms) {
      platforms = typeof user.platforms === 'string' ? JSON.parse(user.platforms) : user.platforms;
    }

    const status = {};
    VALID_PLATFORMS.forEach(platform => {
      const p = platforms[platform];
      status[platform] = {
        connected: p?.status === 'connected',
        name: p?.bot_name || p?.bot_username || p?.page_name || p?.team_name || p?.phone_number || null,
        connected_at: p?.connected_at || null
      };
    });

    res.json(status);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
