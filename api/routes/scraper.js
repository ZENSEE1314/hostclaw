const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const { query } = require('../config/database');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();
router.use(authenticate);

const COST_PER_CONTACT = 5; // 5 messages deducted per scraped contact

// Scrape contacts from Telegram group/channel
router.post('/telegram', async (req, res, next) => {
  try {
    const { group_username, group_id } = req.body;
    if (!group_username && !group_id) {
      return res.status(400).json({ error: 'Group username or ID required' });
    }

    const user = await User.findById(req.user.userId);
    const platforms = parsePlatforms(user);
    const tg = platforms.telegram;

    if (!tg?.bot_token) {
      return res.status(400).json({ error: 'Telegram bot not connected. Connect it first in Platforms.' });
    }

    const token = Buffer.from(tg.bot_token, 'base64').toString();

    // Get group members using Telegram Bot API
    // NOTE: Bot must be admin in the group to get member list
    let chatId = group_id;
    if (!chatId && group_username) {
      chatId = group_username.startsWith('@') ? group_username : '@' + group_username;
    }

    let members = [];
    try {
      // Get chat info first
      const chatInfo = await axios.get(`https://api.telegram.org/bot${token}/getChat`, {
        params: { chat_id: chatId },
        timeout: 10000
      });

      const chat = chatInfo.data.result;
      const chatTitle = chat.title || chat.username || chatId;

      // Get member count
      const countRes = await axios.get(`https://api.telegram.org/bot${token}/getChatMemberCount`, {
        params: { chat_id: chatId },
        timeout: 10000
      });
      const memberCount = countRes.data.result;

      // Try to get administrators (always accessible)
      try {
        const adminsRes = await axios.get(`https://api.telegram.org/bot${token}/getChatAdministrators`, {
          params: { chat_id: chatId },
          timeout: 10000
        });
        for (const admin of adminsRes.data.result || []) {
          if (!admin.user.is_bot) {
            members.push({
              name: [admin.user.first_name, admin.user.last_name].filter(Boolean).join(' '),
              platform: 'telegram',
              platform_id: admin.user.id.toString(),
              group: chatTitle,
              tags: ['admin', chatTitle],
              source: 'telegram_group'
            });
          }
        }
      } catch (e) {
        console.log('Cannot get admins:', e.message);
      }

      // Check if user can afford the contacts
      const balance = await User.getMessageBalance(req.user.userId);
      const cost = members.length * COST_PER_CONTACT;
      const canAfford = balance.is_unlimited || balance.remaining >= cost;

      if (!canAfford) {
        return res.json({
          preview: true,
          group_name: chatTitle,
          total_members: memberCount,
          scrapeable: members.length,
          cost: cost,
          cost_per_contact: COST_PER_CONTACT,
          error: `Not enough messages. Need ${cost} messages (${members.length} contacts x ${COST_PER_CONTACT}). You have ${balance.remaining}.`
        });
      }

      res.json({
        preview: true,
        group_name: chatTitle,
        total_members: memberCount,
        scrapeable: members.length,
        cost: cost,
        cost_per_contact: COST_PER_CONTACT,
        contacts: members,
        message: `Found ${members.length} contacts from "${chatTitle}". Click confirm to add them (costs ${cost} messages).`
      });

    } catch (e) {
      const errMsg = e.response?.data?.description || e.message;
      if (errMsg.includes('not enough rights') || errMsg.includes('administrator')) {
        return res.status(400).json({ error: 'Bot must be an admin in the group to scrape contacts. Add the bot as admin first.' });
      }
      return res.status(400).json({ error: 'Failed to access group: ' + errMsg });
    }
  } catch (error) { next(error); }
});

// Confirm and save scraped contacts
router.post('/confirm', async (req, res, next) => {
  try {
    const { contacts } = req.body;
    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts to save' });
    }

    // Check message balance
    const cost = contacts.length * COST_PER_CONTACT;
    const balance = await User.getMessageBalance(req.user.userId);
    if (!balance.is_unlimited && balance.remaining < cost) {
      return res.status(402).json({
        error: `Not enough messages. Need ${cost} (${contacts.length} x ${COST_PER_CONTACT}). Have ${balance.remaining}.`
      });
    }

    // Deduct messages
    for (let i = 0; i < cost; i++) {
      const ok = await User.deductMessage(req.user.userId);
      if (!ok) {
        return res.status(402).json({ error: `Ran out of messages after adding ${Math.floor(i / COST_PER_CONTACT)} contacts.` });
      }
    }

    // Add to user's contacts (avoid duplicates by platform_id)
    const user = await User.findById(req.user.userId);
    const existing = parseContacts(user);
    const existingIds = new Set(existing.map(c => c.platform_id));

    let added = 0;
    for (const contact of contacts) {
      if (!existingIds.has(contact.platform_id)) {
        existing.push({
          id: crypto.randomUUID(),
          ...contact,
          created_at: new Date().toISOString()
        });
        added++;
      }
    }

    await query(
      'UPDATE users SET contacts = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(existing), req.user.userId]
    );

    res.json({
      added,
      skipped: contacts.length - added,
      total_contacts: existing.length,
      messages_used: cost
    });
  } catch (error) { next(error); }
});

// Scrape from Discord server (requires bot in server)
router.post('/discord', async (req, res, next) => {
  try {
    const { server_id } = req.body;
    if (!server_id) return res.status(400).json({ error: 'Server ID required' });

    const user = await User.findById(req.user.userId);
    const platforms = parsePlatforms(user);
    const dc = platforms.discord;
    if (!dc?.bot_token) {
      return res.status(400).json({ error: 'Discord bot not connected.' });
    }

    const token = Buffer.from(dc.bot_token, 'base64').toString();

    // Get server members
    const membersRes = await axios.get(`https://discord.com/api/v10/guilds/${server_id}/members?limit=100`, {
      headers: { 'Authorization': `Bot ${token}` },
      timeout: 15000
    });

    const members = membersRes.data
      .filter(m => !m.user.bot)
      .map(m => ({
        name: m.user.global_name || m.user.username,
        platform: 'discord',
        platform_id: m.user.id,
        group: 'Discord',
        tags: ['discord', m.roles?.length > 0 ? 'member' : 'new'],
        source: 'discord_server'
      }));

    const cost = members.length * COST_PER_CONTACT;

    res.json({
      preview: true,
      scrapeable: members.length,
      cost,
      cost_per_contact: COST_PER_CONTACT,
      contacts: members,
      message: `Found ${members.length} members. Click confirm to add (costs ${cost} messages).`
    });
  } catch (error) {
    res.status(400).json({ error: 'Failed: ' + (error.response?.data?.message || error.message) });
  }
});

function parsePlatforms(user) {
  if (!user.platforms) return {};
  if (typeof user.platforms === 'object') return user.platforms;
  try { return JSON.parse(user.platforms); } catch { return {}; }
}

function parseContacts(user) {
  if (!user.contacts) return [];
  if (Array.isArray(user.contacts)) return user.contacts;
  try { return JSON.parse(user.contacts); } catch { return []; }
}

module.exports = router;
