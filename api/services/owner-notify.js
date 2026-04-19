// Owner notification helper — sends a WhatsApp message to the user's
// configured owner_phone (their personal contact). Fails silently because
// owner notifications are best-effort and must never break the main flow.

const axios = require('axios');
const { query } = require('../config/database');

const WA_VPS_URL = process.env.WA_VPS_URL || 'http://localhost:3001';

function toJid(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : null;
}

async function getOwnerJid(userId) {
  try {
    const r = await query('SELECT owner_phone FROM users WHERE id = $1', [userId]);
    return toJid(r.rows[0]?.owner_phone);
  } catch {
    return null;
  }
}

async function notifyOwner(userId, text) {
  const jid = await getOwnerJid(userId);
  if (!jid) return false;
  try {
    await axios.post(`${WA_VPS_URL}/session/${userId}/send`, { to: jid, text }, { timeout: 15000 });
    return true;
  } catch (e) {
    console.error('[owner-notify] send failed:', e.message);
    return false;
  }
}

module.exports = { notifyOwner, getOwnerJid };
