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

    for (const contact of targets) {
      try {
        if (contact.platform === 'telegram' && contact.platform_id && platforms.telegram?.bot_token) {
          const token = Buffer.from(platforms.telegram.bot_token, 'base64').toString();
          if (image_url) {
            await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
              chat_id: contact.platform_id,
              photo: image_url,
              caption: message
            });
          } else {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
              chat_id: contact.platform_id,
              text: message
            });
          }
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(`${contact.name}: platform not connected`);
        }
      } catch (e) {
        results.failed++;
        results.errors.push(`${contact.name}: ${e.message}`);
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
