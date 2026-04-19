const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const { query } = require('../config/database');
const crypto = require('crypto');

const router = express.Router();
router.use(authenticate);

// Get all contacts
router.get('/', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const contacts = parseContacts(user);
    res.json({ contacts });
  } catch (error) { next(error); }
});

// Add contact
router.post('/', async (req, res, next) => {
  try {
    const { name, phone, email, platform, platform_id, group, tags } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const user = await User.findById(req.user.userId);
    const contacts = parseContacts(user);

    contacts.push({
      id: crypto.randomUUID(),
      name,
      phone: phone || '',
      email: email || '',
      platform: platform || '',
      platform_id: platform_id || '',
      group: group || 'general',
      tags: tags || [],
      created_at: new Date().toISOString()
    });

    await saveContacts(req.user.userId, contacts);
    res.status(201).json({ contact: contacts[contacts.length - 1] });
  } catch (error) { next(error); }
});

// Update contact
router.patch('/:contactId', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const contacts = parseContacts(user);
    const idx = contacts.findIndex(c => c.id === req.params.contactId);
    if (idx < 0) return res.status(404).json({ error: 'Contact not found' });

    contacts[idx] = { ...contacts[idx], ...req.body, id: contacts[idx].id };
    await saveContacts(req.user.userId, contacts);
    res.json({ contact: contacts[idx] });
  } catch (error) { next(error); }
});

// Delete contact
router.delete('/:contactId', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    let contacts = parseContacts(user);
    contacts = contacts.filter(c => c.id !== req.params.contactId);
    await saveContacts(req.user.userId, contacts);
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// Broadcast message to selected contacts
router.post('/broadcast', async (req, res, next) => {
  try {
    const { message, contact_ids, group, image_url } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const user = await User.findById(req.user.userId);
    const contacts = parseContacts(user);
    const platforms = typeof user.platforms === 'string' ? JSON.parse(user.platforms || '{}') : (user.platforms || {});

    // Filter contacts to send to
    let targets = contacts;
    if (contact_ids && contact_ids.length > 0) {
      targets = contacts.filter(c => contact_ids.includes(c.id));
    } else if (group) {
      targets = contacts.filter(c => c.group === group);
    }

    if (targets.length === 0) {
      return res.status(400).json({ error: 'No contacts selected' });
    }

    const results = { sent: 0, failed: 0, errors: [] };
    const axios = require('axios');

    const WA_VPS_URL = process.env.WA_VPS_URL || 'http://localhost:3001';
    const decode = (s) => Buffer.from(s, 'base64').toString();

    for (const contact of targets) {
      try {
        const to = contact.platform_id;
        if (!to) { results.failed++; results.errors.push(`${contact.name}: missing platform_id`); continue; }

        if (contact.platform === 'telegram' && platforms.telegram?.bot_token) {
          const token = decode(platforms.telegram.bot_token);
          if (image_url) {
            await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, { chat_id: to, photo: image_url, caption: message });
          } else {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: to, text: message });
          }
          results.sent++;
        } else if (contact.platform === 'whatsapp' && platforms.whatsapp?.phone_number_id && platforms.whatsapp?.access_token) {
          // WhatsApp Cloud API (per-user)
          const waCloud = require('../services/whatsapp-cloud');
          await waCloud.sendTextMessage(platforms.whatsapp.phone_number_id, platforms.whatsapp.access_token, to, message);
          results.sent++;
        } else if (contact.platform === 'whatsapp') {
          // Baileys VPS session fallback
          const jid = /@/.test(to) ? to : `${String(to).replace(/\D/g, '')}@s.whatsapp.net`;
          await axios.post(`${WA_VPS_URL}/session/${req.user.userId}/send`, { to: jid, text: message }, { timeout: 15000 });
          results.sent++;
        } else if (contact.platform === 'messenger' && platforms.messenger?.page_token) {
          const token = decode(platforms.messenger.page_token);
          await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id: to }, message: { text: message }
          }, { params: { access_token: token } });
          results.sent++;
        } else if (contact.platform === 'discord' && platforms.discord?.bot_token) {
          const token = decode(platforms.discord.bot_token);
          await axios.post(`https://discord.com/api/v10/channels/${to}/messages`, { content: message.substring(0, 2000) }, { headers: { Authorization: `Bot ${token}` } });
          results.sent++;
        } else if (contact.platform === 'slack' && platforms.slack?.bot_token) {
          const token = decode(platforms.slack.bot_token);
          await axios.post('https://slack.com/api/chat.postMessage', { channel: to, text: message, unfurl_links: false }, { headers: { Authorization: `Bearer ${token}` } });
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(`${contact.name}: ${contact.platform || 'unknown platform'} not connected`);
        }
      } catch (e) {
        results.failed++;
        results.errors.push(`${contact.name}: ${e.response?.data?.error?.message || e.message}`);
      }
    }

    // Deduct messages for broadcasts
    if (results.sent > 0) {
      for (let i = 0; i < results.sent; i++) {
        await User.deductMessage(req.user.userId);
      }
    }

    res.json(results);
  } catch (error) { next(error); }
});

// Get contact groups
router.get('/groups', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const contacts = parseContacts(user);
    const groups = [...new Set(contacts.map(c => c.group || 'general'))];
    res.json({ groups });
  } catch (error) { next(error); }
});

function parseContacts(user) {
  if (!user.contacts) return [];
  if (Array.isArray(user.contacts)) return user.contacts;
  try { return JSON.parse(user.contacts); } catch { return []; }
}

async function saveContacts(userId, contacts) {
  await query(
    'UPDATE users SET contacts = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [JSON.stringify(contacts), userId]
  );
}

module.exports = router;
