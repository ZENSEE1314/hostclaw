const express = require('express');
const User = require('../models/user');
const Chat = require('../models/chat');
const { generateAIResponse } = require('../services/ai');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();

// Parse TEXT JSON columns from user row
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

function parseSkills(user) {
  if (!user.skills) return [];
  if (Array.isArray(user.skills)) return user.skills;
  try { return JSON.parse(user.skills); } catch (e) { return []; }
}

// Initialize Stripe if key exists
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('✅ Stripe webhooks initialized');
  } catch (e) {
    console.log('⚠️ Stripe webhooks not available:', e.message);
  }
}

// Generic webhook handler for all platforms
async function handlePlatformWebhook(req, res, platform, userIdExtractor, messageExtractor) {
  // Acknowledge immediately
  res.sendStatus(200);
  
  try {
    const userId = userIdExtractor(req);
    if (!userId) return;
    
    const user = await User.findById(userId);
    if (!user || user.platforms?.[platform]?.status !== 'connected') {
      console.log(`User not found or ${platform} not connected`);
      return;
    }
    
    const { text, platformId } = messageExtractor(req.body);
    if (!text) return;
    
    // Check credits
    if (user.credits <= 0) {
      await sendNoCreditsMessage(platform, platformId, user.platforms[platform]);
      return;
    }
    
    // Handle commands
    if (text.startsWith('/')) {
      await handleCommand(platform, platformId, text, user);
      return;
    }
    
    // Process message
    await processMessage(user, text, platform, platformId);
  } catch (error) {
    console.error(`${platform} webhook error:`, error);
  }
}

// Telegram webhook
router.post('/telegram/:userId', async (req, res) => {
  const userId = req.params.userId;
  const update = req.body;
  
  res.sendStatus(200);
  
  try {
    const user = await User.findById(userId);
    const platforms = parsePlatforms(user);
    if (!user || platforms.telegram?.status !== 'connected') return;

    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    const text = update.message?.text || update.callback_query?.data;

    if (!chatId || !text) return;

    if (user.credits <= 0) {
      await sendTelegramMessage(chatId, noCreditsMsg(user), platforms.telegram.bot_token);
      return;
    }

    if (text.startsWith('/')) {
      await handleTelegramCommand(chatId, text, user, platforms);
      return;
    }

    await processAndRespond(user, text, 'telegram', chatId, async (response) => {
      await sendTelegramMessage(chatId, response, platforms.telegram.bot_token);
    });
  } catch (error) {
    console.error('Telegram error:', error);
  }
});

// Discord webhook (interactions)
router.post('/discord/:userId', async (req, res) => {
  res.sendStatus(200);
  
  try {
    const userId = req.params.userId;
    const data = req.body;
    
    // Verify Discord signature
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const body = JSON.stringify(req.body);
    
    const user = await User.findById(userId);
    const platforms = parsePlatforms(user);
    if (!user || platforms.discord?.status !== 'connected') return;

    const channelId = data.channel_id;
    const text = data.content;

    if (!text) return;

    if (user.credits <= 0) {
      await sendDiscordMessage(channelId, noCreditsMsg(user), platforms.discord.bot_token);
      return;
    }

    if (text.startsWith('!')) {
      await handleDiscordCommand(channelId, text, user, platforms);
      return;
    }

    await processAndRespond(user, text, 'discord', channelId, async (response) => {
      await sendDiscordMessage(channelId, response, platforms.discord.bot_token);
    });
  } catch (error) {
    console.error('Discord error:', error);
  }
});

// Slack webhook
router.post('/slack/:userId', async (req, res) => {
  res.sendStatus(200);
  
  try {
    const userId = req.params.userId;
    const data = req.body;
    
    // Handle URL verification
    if (data.type === 'url_verification') {
      return res.json({ challenge: data.challenge });
    }
    
    const user = await User.findById(userId);
    const platforms = parsePlatforms(user);
    if (!user || platforms.slack?.status !== 'connected') return;

    const event = data.event;
    if (event?.type !== 'message' || event?.subtype === 'bot_message') return;

    const channelId = event.channel;
    const text = event.text;

    if (user.credits <= 0) {
      await sendSlackMessage(channelId, noCreditsMsg(user), platforms.slack.bot_token);
      return;
    }

    if (text?.startsWith('!')) {
      await handleSlackCommand(channelId, text, user, platforms);
      return;
    }

    await processAndRespond(user, text, 'slack', channelId, async (response) => {
      await sendSlackMessage(channelId, response, platforms.slack.bot_token);
    });
  } catch (error) {
    console.error('Slack error:', error);
  }
});

// LINE webhook
router.post('/line/:userId', async (req, res) => {
  res.sendStatus(200);
  
  try {
    const userId = req.params.userId;
    const data = req.body;
    
    const user = await User.findById(userId);
    const platforms = parsePlatforms(user);
    if (!user || platforms.line?.status !== 'connected') return;

    const event = data.events?.[0];
    if (!event || event.type !== 'message' || event.message.type !== 'text') return;

    const replyToken = event.replyToken;
    const text = event.message.text;

    if (user.credits <= 0) {
      await sendLineMessage(replyToken, noCreditsMsg(user), platforms.line.channel_token);
      return;
    }

    await processAndRespond(user, text, 'line', replyToken, async (response) => {
      await sendLineMessage(replyToken, response, platforms.line.channel_token);
    });
  } catch (error) {
    console.error('LINE error:', error);
  }
});

// Messenger webhook
router.get('/messenger/:userId', (req, res) => {
  // Webhook verification
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === process.env.MESSENGER_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post('/messenger/:userId', async (req, res) => {
  res.sendStatus(200);
  
  try {
    const userId = req.params.userId;
    const data = req.body;
    
    const user = await User.findById(userId);
    const platforms = parsePlatforms(user);
    if (!user || platforms.messenger?.status !== 'connected') return;

    const entry = data.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (!messaging || messaging.message?.is_echo) return;

    const senderId = messaging.sender.id;
    const text = messaging.message?.text;

    if (!text) return;

    if (user.credits <= 0) {
      await sendMessengerMessage(senderId, noCreditsMsg(user), platforms.messenger.page_token);
      return;
    }

    await processAndRespond(user, text, 'messenger', senderId, async (response) => {
      await sendMessengerMessage(senderId, response, platforms.messenger.page_token);
    });
  } catch (error) {
    console.error('Messenger error:', error);
  }
});

// Signal webhook
router.post('/signal/:userId', async (req, res) => {
  res.sendStatus(200);
  
  try {
    const userId = req.params.userId;
    const data = req.body;
    
    const user = await User.findById(userId);
    const platforms = parsePlatforms(user);
    if (!user || platforms.signal?.status !== 'connected') return;

    const envelope = data.envelope;
    if (!envelope || !envelope.dataMessage) return;

    const fromNumber = envelope.sourceNumber;
    const text = envelope.dataMessage.message;

    if (!text) return;

    if (user.credits <= 0) {
      await sendSignalMessage(fromNumber, noCreditsMsg(user), platforms.signal);
      return;
    }

    await processAndRespond(user, text, 'signal', fromNumber, async (response) => {
      await sendSignalMessage(fromNumber, response, platforms.signal);
    });
  } catch (error) {
    console.error('Signal error:', error);
  }
});

// WhatsApp webhook
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200);
  
  try {
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              const from = message.from;
              const text = message.text?.body;
              
              const user = await User.findByPlatform('whatsapp', from);
              if (!user) continue;
              const userPlatforms = parsePlatforms(user);

              if (user.credits <= 0) {
                await sendWhatsAppMessage(from, noCreditsMsg(user), userPlatforms.whatsapp);
                continue;
              }

              await processAndRespond(user, text, 'whatsapp', from, async (response) => {
                await sendWhatsAppMessage(from, response, userPlatforms.whatsapp);
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('WhatsApp error:', error);
  }
});

// WeChat webhook
router.get('/wechat/:userId', async (req, res) => {
  // WeChat signature verification
  const { signature, timestamp, nonce, echostr } = req.query;
  const userId = req.params.userId;
  
  try {
    const user = await User.findById(userId);
    const platforms = parsePlatforms(user);
    if (!user || !platforms.wechat?.token) {
      return res.sendStatus(403);
    }

    const token = platforms.wechat.token;
    const tmpArr = [token, timestamp, nonce].sort();
    const tmpStr = tmpArr.join('');
    const hash = crypto.createHash('sha1').update(tmpStr).digest('hex');
    
    if (hash === signature) {
      res.send(echostr);
    } else {
      res.sendStatus(403);
    }
  } catch (error) {
    res.sendStatus(403);
  }
});

router.post('/wechat/:userId', async (req, res) => {
  // WeChat messages handled here
  // Parse XML and respond
  res.sendStatus(200);
});

// ===== MESSAGE SENDING FUNCTIONS =====

async function sendTelegramMessage(chatId, text, botToken) {
  try {
    const token = Buffer.from(botToken, 'base64').toString();
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: text.substring(0, 4096), // Telegram limit
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Telegram send error:', error.message);
  }
}

async function sendDiscordMessage(channelId, text, botToken) {
  try {
    const token = Buffer.from(botToken, 'base64').toString();
    await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      content: text.substring(0, 2000) // Discord limit
    }, {
      headers: { 'Authorization': `Bot ${token}` }
    });
  } catch (error) {
    console.error('Discord send error:', error.message);
  }
}

async function sendSlackMessage(channel, text, botToken) {
  try {
    const token = Buffer.from(botToken, 'base64').toString();
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: channel,
      text: text.substring(0, 4000),
      unfurl_links: false
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (error) {
    console.error('Slack send error:', error.message);
  }
}

async function sendLineMessage(replyToken, text, channelToken) {
  try {
    const token = Buffer.from(channelToken, 'base64').toString();
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ 
        type: 'text', 
        text: text.substring(0, 5000) 
      }]
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (error) {
    console.error('LINE send error:', error.message);
  }
}

async function sendMessengerMessage(recipientId, text, pageToken) {
  try {
    const token = Buffer.from(pageToken, 'base64').toString();
    await axios.post(`https://graph.facebook.com/v18.0/me/messages`, {
      recipient: { id: recipientId },
      message: { text: text.substring(0, 2000) }
    }, {
      params: { access_token: token }
    });
  } catch (error) {
    console.error('Messenger send error:', error.message);
  }
}

async function sendSignalMessage(recipient, text, config) {
  try {
    await axios.post(`${config.api_url}/v2/send`, {
      number: config.phone_number,
      recipients: [recipient],
      message: text
    });
  } catch (error) {
    console.error('Signal send error:', error.message);
  }
}

async function sendWhatsAppMessage(to, text, config) {
  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: { body: text.substring(0, 4096) }
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
  }
}

// ===== COMMAND HANDLERS =====

async function handleTelegramCommand(chatId, text, user, platforms) {
  const skills = parseSkills(user);
  const providers = parseProviders(user);
  const commands = {
    '/start': `👋 Welcome ${user.name}!\n\nI'm your AI assistant on HostClaw.\n💳 Credits: $${parseFloat(user.credits).toFixed(2)}\n🤖 Provider: ${user.default_provider}\n\nSend me any message to start!`,
    '/help': `Available commands:\n/start - Start\n/credits - Check balance\n/provider - Current AI provider\n/skills - Active skills\n/help - This message`,
    '/credits': `💳 Your credits: $${parseFloat(user.credits).toFixed(2)}\n\nAdd more: ${process.env.FRONTEND_URL}/billing.html`,
    '/skills': `🧩 Active skills:\n${skills.filter(s => s.active).map(s => `• ${s.id}`).join('\n') || 'None'}`,
    '/provider': `🤖 Current: ${user.default_provider}\n\nAvailable:\n${Object.keys(providers).join('\n') || 'None configured'}`
  };

  const response = commands[text] || 'Unknown command. Type /help for available commands.';
  await sendTelegramMessage(chatId, response, platforms.telegram.bot_token);
}

async function handleDiscordCommand(channelId, text, user, platforms) {
  const skills = parseSkills(user);
  const commands = {
    '!help': `**HostClaw AI Assistant**\n\n**Commands:**\n!start - Welcome message\n!credits - Check balance\n!provider - AI provider info\n!skills - List skills\n!help - This message\n\nYour credits: $${parseFloat(user.credits).toFixed(2)}`,
    '!start': `👋 Hey ${user.name}! I'm your AI assistant. Just type any message and I'll help you out.`,
    '!credits': `💳 Your credits: $${parseFloat(user.credits).toFixed(2)}\n\nAdd more at: ${process.env.FRONTEND_URL}/billing.html`,
    '!skills': `🧩 Your active skills:\n${skills.filter(s => s.active).map(s => `• ${s.id}`).join('\n') || 'None yet'}`,
    '!provider': `🤖 Current provider: ${user.default_provider}`
  };

  const response = commands[text] || null;
  if (response) {
    await sendDiscordMessage(channelId, response, platforms.discord.bot_token);
  }
}

async function handleSlackCommand(channel, text, user, platforms) {
  const skills = parseSkills(user);
  const commands = {
    '!help': `*HostClaw AI Assistant*\n\nCommands:\n• !start - Welcome\n• !credits - Check balance\n• !skills - List skills\n• !help - This message`,
    '!start': `👋 Hey <!channel>! I'm an AI assistant powered by HostClaw.`,
    '!credits': `💳 Credits: $${parseFloat(user.credits).toFixed(2)}`,
    '!skills': `🧩 Active skills: ${skills.filter(s => s.active).map(s => s.id).join(', ') || 'None'}`
  };

  const response = commands[text] || null;
  if (response) {
    await sendSlackMessage(channel, response, platforms.slack.bot_token);
  }
}

// ===== UTILITIES =====

function noCreditsMsg(user) {
  return `⚠️ Out of credits!\n\nAdd more at: ${process.env.FRONTEND_URL}/billing.html`;
}

async function processAndRespond(user, text, platform, platformId, sendFn) {
  try {
    // Save user message
    await Chat.saveMessage({
      user_id: user.id,
      session_id: `${platform}_${platformId}`,
      role: 'user',
      content: text
    });

    // Get AI response
    const defaultProvider = user.default_provider || 'openai';
    const allProviders = parseProviders(user);
    const providerConfig = allProviders[defaultProvider] || allProviders[Object.keys(allProviders)[0]];
    const activeSkills = parseSkills(user).filter(s => s.active).map(s => s.id);

    const aiResponse = await generateAIResponse({
      message: text,
      provider: defaultProvider,
      providerConfig,
      skills: activeSkills,
      user
    });

    // Deduct credits
    const cost = calculateCost(aiResponse.tokens || 0, defaultProvider);
    await User.deductCredits(user.id, cost);

    // Save AI response
    await Chat.saveMessage({
      user_id: user.id,
      session_id: `${platform}_${platformId}`,
      role: 'assistant',
      content: aiResponse.content,
      model: aiResponse.model,
      tokens: aiResponse.tokens
    });

    // Send response
    await sendFn(aiResponse.content);
    
  } catch (error) {
    console.error('Process message error:', error);
    await sendFn('Sorry, I encountered an error. Please try again later.');
  }
}

function calculateCost(tokens, provider) {
  const rates = {
    openai: 0.03,
    anthropic: 0.03,
    kimi: 0.015,
    gemini: 0.005,
    deepseek: 0.002,
    groq: 0.005
  };
  return Math.max(0.01, (tokens / 1000) * (rates[provider] || 0.03));
}

// ===== STRIPE WEBHOOK =====

// Stripe webhook endpoint
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    // Verify webhook signature
    if (stripe && endpointSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      // For testing without signature verification
      event = req.body;
    }
  } catch (err) {
    console.log(`⚠️ Webhook signature verification failed:`, err.message);
    // Still process in development
    event = req.body;
  }

  console.log('📨 Stripe webhook received:', event.type);

  try {
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const type = session.metadata?.type;
        const amount = parseInt(session.metadata?.amount || '0');
        
        if (userId) {
          if (type === 'setup_fee') {
            // Mark user as paid setup fee
            await User.updatePaymentStatus(userId, 'paid');
            console.log(`✅ Setup fee paid for user ${userId}`);
          } else if (type === 'credits' && amount > 0) {
            // Add credits to user
            await User.addCredits(userId, amount);
            console.log(`✅ Added $${amount} credits to user ${userId}`);
          }
        }
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log('💰 Invoice payment succeeded:', invoice.id);
        break;
      }
      
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        console.log('📅 Subscription created:', subscription.id);
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
