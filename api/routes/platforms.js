const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const axios = require('axios');
const { generateAIResponse } = require('../services/ai');

// Lazy-load WhatsApp service — prevents server crash if Baileys not installed
let _waService = null;
function getWAService() {
  if (_waService) return _waService;
  try {
    _waService = require('../services/whatsapp');
    return _waService;
  } catch (e) {
    console.error('WhatsApp service unavailable:', e.message);
    return null;
  }
}

const router = express.Router();

const API_BASE = process.env.API_URL || 'https://chatsai.app';
const VALID_PLATFORMS = ['whatsapp', 'telegram', 'discord', 'slack', 'line', 'messenger', 'signal', 'wechat'];

function parsePlatforms(user) {
  if (!user.platforms) return {};
  if (typeof user.platforms === 'object') return user.platforms;
  try { return JSON.parse(user.platforms); } catch (e) { return {}; }
}

function parseProviders(user) {
  if (!user.api_providers) return {};
  if (typeof user.api_providers === 'object') return user.api_providers;
  try { return JSON.parse(user.api_providers); } catch (e) { return {}; }
}

// Get user's connected platforms
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json({ platforms: parsePlatforms(user) });
  } catch (error) {
    next(error);
  }
});

// Get connection status for all platforms
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const platforms = parsePlatforms(user);

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

// Debug: check WhatsApp service availability
router.get('/whatsapp/check', authenticate, async (req, res) => {
  const wa = getWAService();
  if (!wa) {
    return res.json({ available: false, error: 'Baileys library not loaded. Check npm install.' });
  }
  const session = wa.getSession(req.user.userId);
  const user = await User.findById(req.user.userId);
  const plats = parsePlatforms(user);
  res.json({
    available: true,
    hasSession: !!session,
    sessionStatus: session?.status || null,
    dbStatus: plats.whatsapp?.status || 'not connected'
  });
});

// ===== WHATSAPP CLOUD API — Official Meta API =====
router.post('/whatsapp/cloud-connect', authenticate, async (req, res) => {
  try {
    const { phoneNumberId, accessToken, businessAccountId } = req.body;

    if (!phoneNumberId || !accessToken) {
      return res.status(400).json({ error: 'Phone Number ID and Access Token are required' });
    }

    // Verify credentials with Meta
    const waCloud = require('../services/whatsapp-cloud');
    let phoneInfo;
    try {
      phoneInfo = await waCloud.getPhoneNumberInfo(phoneNumberId, accessToken);
    } catch (e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      return res.status(400).json({ error: 'Invalid credentials: ' + errMsg });
    }

    const displayPhone = phoneInfo.display_phone_number || phoneNumberId;
    const verifiedName = phoneInfo.verified_name || 'WhatsApp Business';

    // Save to DB
    await User.updatePlatform(req.user.userId, 'whatsapp', {
      status: 'connected',
      type: 'cloud_api',
      phone_number_id: phoneNumberId,
      access_token: accessToken,
      business_account_id: businessAccountId || null,
      phone_number: displayPhone,
      bot_name: verifiedName,
      connected_at: new Date().toISOString()
    });

    res.json({
      message: 'WhatsApp Business connected via Cloud API',
      phone_number: displayPhone,
      verified_name: verifiedName,
      webhook_url: `${API_BASE}/webhooks/whatsapp`
    });
  } catch (error) {
    console.error('WhatsApp Cloud connect error:', error);
    res.status(500).json({ error: 'Failed to connect: ' + error.message });
  }
});

// ===== WHATSAPP VPS BRIDGE — Proxy to DigitalOcean VPS =====
const WA_VPS_URL = process.env.WA_VPS_URL || 'http://178.128.103.14:3001';

router.post('/whatsapp/vps-start', authenticate, async (req, res) => {
  try {
    const result = await axios.post(`${WA_VPS_URL}/session/start`, { userId: req.user.userId }, { timeout: 15000 });
    res.json(result.data);
  } catch (e) {
    res.status(500).json({ error: 'VPS bridge error: ' + (e.response?.data?.error || e.message) });
  }
});

router.get('/whatsapp/vps-qr', authenticate, async (req, res) => {
  try {
    const result = await axios.get(`${WA_VPS_URL}/session/${req.user.userId}/qr`, { timeout: 10000 });
    res.json(result.data);
  } catch (e) {
    res.json({ status: 'not_started' });
  }
});

// Callback from VPS when WhatsApp connects
router.post('/whatsapp/vps-connected', async (req, res) => {
  try {
    const { userId, phoneNumber, name } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await User.updatePlatform(userId, 'whatsapp', {
      status: 'connected',
      type: 'vps_baileys',
      phone_number: phoneNumber,
      bot_name: name || phoneNumber,
      vps_url: WA_VPS_URL,
      connected_at: new Date().toISOString()
    });
    res.json({ saved: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== WHATSAPP — QR Code via Baileys (local only, deprecated) =====
router.post('/whatsapp/start', authenticate, async (req, res) => {
  const userId = req.user.userId;
  const wa = getWAService();
  if (!wa) return res.status(503).json({ error: 'WhatsApp service is not available. Contact support.' });
  try {
    await wa.createSession(
      userId,
      // onConnected: save to DB
      async (phoneNumber, name) => {
        await User.updatePlatform(userId, 'whatsapp', {
          status: 'connected',
          phone_number: phoneNumber,
          bot_name: name,
          connected_at: new Date().toISOString()
        });
      },
      // onMessage: AI reply with chat history and agent knowledge
      async (chatJid, text, sock) => {
        const user = await User.findById(userId);
        if (!user) return;

        // Check message balance
        if (!User.canSendMessage(user)) {
          await sock.sendMessage(chatJid, { text: 'Message limit reached. Please upgrade your plan at chatsai.ai to continue.' });
          return;
        }

        // Deduct message before AI call
        const deducted = await User.deductMessage(userId);
        if (!deducted) {
          await sock.sendMessage(chatJid, { text: 'Message limit reached. Upgrade at chatsai.ai' });
          return;
        }

        const sessionId = `whatsapp_${chatJid}`;
        const Chat = require('../models/chat');
        const Agent = require('../models/agent');

        // Save user message
        await Chat.saveMessage({ user_id: userId, session_id: sessionId, role: 'user', content: text });

        // Get chat history + agent config
        const chatHistory = await Chat.getSessionHistory(userId, sessionId, 10);
        const agent = await Agent.findDefaultForUser(userId);

        const providers = parseProviders(user);
        const defProv = user.default_provider || 'openai';
        const providerConfig = providers[defProv] || providers[Object.keys(providers)[0]] || null;

        const aiRes = await generateAIResponse({
          message: text,
          provider: defProv,
          providerConfig,
          skills: [],
          chatHistory,
          agent
        });

        await sock.sendMessage(chatJid, { text: aiRes.content });

        // Save AI response
        await Chat.saveMessage({ user_id: userId, session_id: sessionId, role: 'assistant', content: aiRes.content, model: aiRes.model, tokens: aiRes.tokens });
      }
    );
    res.json({ message: 'WhatsApp QR session started' });
  } catch (error) {
    console.error('WhatsApp start error:', error);
    res.status(500).json({ error: 'Failed to start WhatsApp: ' + error.message });
  }
});

// Poll for WhatsApp QR code / connection status
router.get('/whatsapp/qr', authenticate, async (req, res) => {
  const userId = req.user.userId;
  const wa = getWAService();
  const session = wa ? wa.getSession(userId) : null;

  if (!session) {
    const user = await User.findById(userId);
    const plats = parsePlatforms(user);
    if (plats.whatsapp?.status === 'connected') return res.json({ status: 'connected' });
    return res.json({ status: 'not_started' });
  }

  res.json({
    status: session.status,
    qrDataUrl: session.qrDataUrl || null,
    connected: session.connected
  });
});

// Disconnect WhatsApp
router.delete('/whatsapp', authenticate, async (req, res) => {
  getWAService()?.deleteSession(req.user.userId);
  await User.removePlatform(req.user.userId, 'whatsapp').catch(() => {});
  res.json({ message: 'WhatsApp disconnected' });
});

// ===== TELEGRAM =====
router.post('/telegram/connect', authenticate, async (req, res) => {
  try {
    const { botToken } = req.body;

    if (!botToken) {
      return res.status(400).json({ error: 'Bot token is required' });
    }

    // Validate token format (flexible length)
    if (!botToken.match(/^\d+:[A-Za-z0-9_-]{30,}$/)) {
      return res.status(400).json({ error: 'Invalid bot token format. Expected: 123456789:ABCdef...' });
    }

    // Verify with Telegram API
    let botInfo;
    try {
      const telegramRes = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, { timeout: 10000 });
      if (!telegramRes.data.ok) {
        return res.status(400).json({ error: 'Invalid bot token — Telegram rejected it' });
      }
      botInfo = telegramRes.data.result;
    } catch (e) {
      return res.status(400).json({ error: 'Could not verify token with Telegram. Check the token and try again.' });
    }

    // Save to DB
    await User.updatePlatform(req.user.userId, 'telegram', {
      status: 'connected',
      bot_token: Buffer.from(botToken).toString('base64'),
      bot_username: botInfo.username,
      bot_name: botInfo.first_name,
      connected_at: new Date().toISOString()
    });

    // Set webhook — non-fatal
    const webhookBase = `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${webhookBase}/webhooks/telegram/${req.user.userId}`;
    try {
      const webhookRes = await axios.post(`https://api.telegram.org/bot${botToken}/setWebhook`, { url: webhookUrl }, { timeout: 10000 });
      if (!webhookRes.data.ok) {
        console.warn('Telegram webhook setup returned not-ok:', webhookRes.data.description);
      }
    } catch (e) {
      console.warn('Telegram webhook setup failed (non-fatal):', e.message);
    }

    res.json({
      message: 'Telegram bot connected successfully',
      bot_username: botInfo.username,
      bot_name: botInfo.first_name
    });
  } catch (error) {
    console.error('Telegram connection error:', error);
    res.status(500).json({ error: 'Failed to connect Telegram: ' + error.message });
  }
});

// ===== DISCORD =====
router.post('/discord/connect', authenticate, async (req, res) => {
  try {
    const { botToken } = req.body;
    if (!botToken) return res.status(400).json({ error: 'Bot token is required' });

    let botInfo;
    try {
      const discordRes = await axios.get('https://discord.com/api/v10/users/@me', {
        headers: { 'Authorization': `Bot ${botToken}` },
        timeout: 10000
      });
      botInfo = discordRes.data;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid Discord bot token' });
    }

    await User.updatePlatform(req.user.userId, 'discord', {
      status: 'connected',
      bot_token: Buffer.from(botToken).toString('base64'),
      bot_username: botInfo.username,
      bot_id: botInfo.id,
      connected_at: new Date().toISOString()
    });

    res.json({
      message: 'Discord bot connected successfully',
      bot_username: botInfo.username,
      invite_url: `https://discord.com/api/oauth2/authorize?client_id=${botInfo.id}&permissions=309237664768&scope=bot`
    });
  } catch (error) {
    console.error('Discord connection error:', error);
    res.status(500).json({ error: 'Failed to connect Discord: ' + error.message });
  }
});

// ===== SLACK =====
router.post('/slack/connect', authenticate, async (req, res) => {
  try {
    const { botToken, signingSecret } = req.body;
    if (!botToken || !botToken.startsWith('xoxb-')) {
      return res.status(400).json({ error: 'Valid Bot User OAuth Token required (starts with xoxb-)' });
    }

    let teamInfo;
    try {
      const slackRes = await axios.get('https://slack.com/api/auth.test', {
        headers: { 'Authorization': `Bearer ${botToken}` },
        timeout: 10000
      });
      if (!slackRes.data.ok) return res.status(400).json({ error: 'Invalid Slack token: ' + slackRes.data.error });

      const teamRes = await axios.get('https://slack.com/api/team.info', {
        headers: { 'Authorization': `Bearer ${botToken}` },
        timeout: 10000
      });
      teamInfo = { team_name: teamRes.data.team?.name, team_id: slackRes.data.team_id };
    } catch (e) {
      return res.status(400).json({ error: 'Could not verify Slack token' });
    }

    await User.updatePlatform(req.user.userId, 'slack', {
      status: 'connected',
      bot_token: Buffer.from(botToken).toString('base64'),
      signing_secret: signingSecret ? Buffer.from(signingSecret).toString('base64') : null,
      team_name: teamInfo.team_name,
      team_id: teamInfo.team_id,
      connected_at: new Date().toISOString()
    });

    res.json({ message: 'Slack workspace connected', team_name: teamInfo.team_name });
  } catch (error) {
    console.error('Slack connection error:', error);
    res.status(500).json({ error: 'Failed to connect Slack: ' + error.message });
  }
});

// ===== LINE =====
router.post('/line/connect', authenticate, async (req, res) => {
  try {
    const { channelSecret, channelAccessToken } = req.body;
    if (!channelSecret || !channelAccessToken) {
      return res.status(400).json({ error: 'Channel secret and access token are required' });
    }

    let botInfo;
    try {
      const lineRes = await axios.get('https://api.line.me/v2/bot/info', {
        headers: { 'Authorization': `Bearer ${channelAccessToken}` },
        timeout: 10000
      });
      botInfo = lineRes.data;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid LINE credentials' });
    }

    await User.updatePlatform(req.user.userId, 'line', {
      status: 'connected',
      channel_secret: Buffer.from(channelSecret).toString('base64'),
      channel_token: Buffer.from(channelAccessToken).toString('base64'),
      bot_name: botInfo.displayName,
      bot_id: botInfo.userId,
      connected_at: new Date().toISOString()
    });

    // Set webhook — non-fatal
    try {
      const lineWebhookBase = `${req.protocol}://${req.get('host')}`;
      await axios.put('https://api.line.me/v2/bot/channel/webhook/endpoint', {
        webhook_endpoint: `${lineWebhookBase}/webhooks/line/${req.user.userId}`
      }, {
        headers: { 'Authorization': `Bearer ${channelAccessToken}` },
        timeout: 10000
      });
    } catch (e) {
      console.warn('LINE webhook setup failed (non-fatal):', e.message);
    }

    res.json({ message: 'LINE bot connected', bot_name: botInfo.displayName });
  } catch (error) {
    console.error('LINE connection error:', error);
    res.status(500).json({ error: 'Failed to connect LINE: ' + error.message });
  }
});

// ===== MESSENGER =====
router.post('/messenger/connect', authenticate, async (req, res) => {
  try {
    const { pageAccessToken, pageId } = req.body;
    if (!pageAccessToken || !pageId) {
      return res.status(400).json({ error: 'Page access token and page ID are required' });
    }

    let pageName;
    try {
      const fbRes = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
        params: { access_token: pageAccessToken },
        timeout: 10000
      });
      pageName = fbRes.data.name;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid Facebook credentials or Page ID' });
    }

    await User.updatePlatform(req.user.userId, 'messenger', {
      status: 'connected',
      page_token: Buffer.from(pageAccessToken).toString('base64'),
      page_id: pageId,
      page_name: pageName,
      connected_at: new Date().toISOString()
    });

    res.json({ message: 'Facebook Messenger connected', page_name: pageName });
  } catch (error) {
    console.error('Messenger connection error:', error);
    res.status(500).json({ error: 'Failed to connect Messenger: ' + error.message });
  }
});

// ===== SIGNAL =====
router.post('/signal/connect', authenticate, async (req, res) => {
  try {
    const { phoneNumber, signalCliRestApiUrl } = req.body;
    if (!phoneNumber || !signalCliRestApiUrl) {
      return res.status(400).json({ error: 'Phone number and Signal CLI REST API URL are required' });
    }

    try {
      await axios.get(`${signalCliRestApiUrl}/v1/about`, { timeout: 10000 });
    } catch (e) {
      return res.status(400).json({ error: 'Cannot reach Signal CLI REST API. Make sure it is running.' });
    }

    await User.updatePlatform(req.user.userId, 'signal', {
      status: 'connected',
      phone_number: phoneNumber,
      api_url: signalCliRestApiUrl,
      connected_at: new Date().toISOString()
    });

    res.json({ message: 'Signal connected' });
  } catch (error) {
    console.error('Signal connection error:', error);
    res.status(500).json({ error: 'Failed to connect Signal: ' + error.message });
  }
});

// ===== TELEGRAM: RE-VERIFY WEBHOOK =====
router.post('/telegram/webhook', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const platforms = parsePlatforms(user);
    const tg = platforms.telegram;
    if (!tg || tg.status !== 'connected') {
      return res.status(400).json({ error: 'Telegram is not connected' });
    }
    const botToken = Buffer.from(tg.bot_token, 'base64').toString();
    const webhookUrl = `${req.protocol}://${req.get('host')}/webhooks/telegram/${req.user.userId}`;
    const webhookRes = await axios.post(`https://api.telegram.org/bot${botToken}/setWebhook`, { url: webhookUrl }, { timeout: 10000 });
    if (!webhookRes.data.ok) {
      return res.status(400).json({ error: 'Telegram rejected webhook: ' + webhookRes.data.description });
    }
    res.json({ message: 'Webhook updated', url: webhookUrl });
  } catch (error) {
    console.error('Telegram webhook re-verify error:', error);
    res.status(500).json({ error: 'Failed to update webhook: ' + error.message });
  }
});

// ===== DISCONNECT ANY =====
router.delete('/:platform', authenticate, async (req, res, next) => {
  try {
    const { platform } = req.params;
    if (!VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }
    if (platform === 'whatsapp') {
      getWAService()?.deleteSession(req.user.userId);
    }
    await User.removePlatform(req.user.userId, platform);
    res.json({ message: `${platform} disconnected` });
  } catch (error) {
    next(error);
  }
});

// ===== PLATFORM CONFIG (save bot personality for platform setup wizard) =====
router.post('/config', authenticate, async (req, res, next) => {
  try {
    const { system_prompt, personality } = req.body;
    const Agent = require('../models/agent');
    // Save to user's default agent
    const agent = await Agent.findDefaultForUser(req.user.userId);
    if (agent) {
      const updates = {};
      if (system_prompt) updates.system_prompt = system_prompt;
      if (personality) {
        const config = agent.config || {};
        config.personality = personality;
        updates.config = config;
      }
      if (Object.keys(updates).length > 0) {
        await Agent.update(agent.id, req.user.userId, updates);
      }
    }
    res.json({ saved: true });
  } catch (error) { next(error); }
});

module.exports = router;
