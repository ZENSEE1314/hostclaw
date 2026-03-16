const express = require('express');
const User = require('../models/user');
const Chat = require('../models/chat');
const { generateAIResponse } = require('../services/ai');

const router = express.Router();

// Telegram webhook endpoint
router.post('/telegram/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const update = req.body;

    // Acknowledge receipt immediately
    res.sendStatus(200);

    // Process message asynchronously
    if (update.message) {
      const { message } = update;
      const chatId = message.chat.id;
      const text = message.text;

      // Get user
      const user = await User.findById(userId);
      if (!user || user.platforms?.telegram?.status !== 'connected') {
        console.log('User not found or telegram not connected');
        return;
      }

      // Check credits
      if (user.credits <= 0) {
        await sendTelegramMessage(chatId, 
          '⚠️ You have no credits left. Please add credits at: ' + 
          `${process.env.FRONTEND_URL}/billing.html`,
          user.platforms.telegram.bot_token
        );
        return;
      }

      // Handle commands
      if (text?.startsWith('/')) {
        await handleTelegramCommand(chatId, text, user);
        return;
      }

      // Process regular message
      await processMessage(user, text, 'telegram', chatId);
    }
  } catch (error) {
    console.error('Telegram webhook error:', error);
  }
});

// WhatsApp webhook verification (Meta requirement)
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp webhook for messages
router.post('/whatsapp', async (req, res) => {
  try {
    const body = req.body;

    // Acknowledge receipt immediately
    res.sendStatus(200);

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              const from = message.from; // Phone number
              const text = message.text?.body;

              // Find user by WhatsApp phone number
              const user = await User.findByPlatform('whatsapp', from);
              if (!user) {
                console.log('No user found for WhatsApp number:', from);
                continue;
              }

              // Check credits
              if (user.credits <= 0) {
                await sendWhatsAppMessage(from, 
                  '⚠️ You have no credits left. Please add credits at: ' + 
                  `${process.env.FRONTEND_URL}/billing.html`,
                  user.platforms.whatsapp.access_token
                );
                continue;
              }

              // Process message
              await processMessage(user, text, 'whatsapp', from);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
  }
});

// Handle Telegram commands
async function handleTelegramCommand(chatId, text, user) {
  const commands = {
    '/start': `👋 Welcome ${user.name}!\n\nI'm your AI assistant connected to HostClaw.\n\nYour credits: $${user.credits.toFixed(2)}\n\nJust send me a message and I'll help you!`,
    '/help': `Available commands:\n/start - Start the bot\n/credits - Check your credits\n/switch - Switch AI provider\n/skills - List your active skills\n/help - Show this help`,
    '/credits': `💳 Your credits: $${user.credits.toFixed(2)}\n\nAdd more at: ${process.env.FRONTEND_URL}/billing.html`,
    '/skills': `🧩 Your active skills:\n${(user.skills || []).filter(s => s.active).map(s => `• ${s.id}`).join('\n') || 'No active skills'}`,
    '/switch': `🤖 Current provider: ${user.default_provider}\n\nAvailable providers:\n${Object.keys(user.api_providers || {}).join('\n')}\n\nUse web app to switch providers.`
  };

  const response = commands[text] || 'Unknown command. Type /help for available commands.';
  
  await sendTelegramMessage(
    chatId, 
    response, 
    user.platforms.telegram.bot_token
  );
}

// Process incoming message and send AI response
async function processMessage(user, text, platform, platformId) {
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
    const providerConfig = user.api_providers?.[defaultProvider];
    const activeSkills = (user.skills || []).filter(s => s.active).map(s => s.id);

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

    // Send response based on platform
    if (platform === 'telegram') {
      await sendTelegramMessage(platformId, aiResponse.content, user.platforms.telegram.bot_token);
    } else if (platform === 'whatsapp') {
      await sendWhatsAppMessage(platformId, aiResponse.content, user.platforms.whatsapp.access_token);
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
}

// Send Telegram message
async function sendTelegramMessage(chatId, text, botToken) {
  try {
    const decryptedToken = Buffer.from(botToken, 'base64').toString();
    const response = await fetch(`https://api.telegram.org/bot${decryptedToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return false;
  }
}

// Send WhatsApp message
async function sendWhatsAppMessage(to, text, accessToken) {
  try {
    const decryptedToken = Buffer.from(accessToken, 'base64').toString();
    const response = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decryptedToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text }
      })
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return false;
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
  
  const rate = rates[provider] || 0.03;
  return Math.max(0.01, (tokens / 1000) * rate);
}

module.exports = router;
