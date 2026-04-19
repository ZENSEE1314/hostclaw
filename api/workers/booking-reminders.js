// Background worker: scans all agents' bookings and sends WhatsApp reminders
// 1 day and 1 hour before the appointment. Dedupes via booking.reminders_sent[] so
// the same reminder never fires twice.

const { query } = require('../config/database');
const axios = require('axios');

const POLL_INTERVAL_MS = 5 * 60 * 1000;   // check every 5 minutes
const WINDOW_MS = 10 * 60 * 1000;         // fire within a +/- 10min window of target

const WA_VPS_URL = process.env.WA_VPS_URL || 'http://localhost:3001';

function parseBookingDateTime(b) {
  // booking.date: YYYY-MM-DD, booking.time: HH:MM (24h or "9:00 am")
  if (!b.date || !b.time) return null;
  let t = String(b.time).trim();

  const ampm = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const isPm = ampm[3].toLowerCase() === 'pm';
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Assume server-local time — keep it simple
  const iso = `${b.date}T${t}:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

async function sendWhatsAppReminder(userId, toJid, text) {
  try {
    await axios.post(`${WA_VPS_URL}/session/${userId}/send`, {
      to: toJid,
      text
    }, { timeout: 15000 });
    return true;
  } catch (e) {
    console.error(`[reminder] send failed to ${toJid}:`, e.message);
    return false;
  }
}

function reminderMessage(kind, booking, businessName) {
  const when = `${booking.date} at ${booking.time}`;
  const what = booking.service || booking.package || booking.customer_name || 'your appointment';
  const name = businessName || 'us';
  if (kind === '1d') {
    return `Hi${booking.customer_name ? ' ' + booking.customer_name : ''}! Just a friendly reminder — you have a booking with ${name} tomorrow (${when}) for ${what}. See you then!`;
  }
  return `Hi${booking.customer_name ? ' ' + booking.customer_name : ''}! Your booking with ${name} is in about an hour (${when}) — ${what}. See you soon!`;
}

async function processOnce() {
  try {
    const res = await query(`
      SELECT a.id AS agent_id, a.user_id, a.business_name, a.bookings, a.knowledge_base, a.linked_platforms
      FROM agents a
      WHERE a.bookings IS NOT NULL AND a.bookings::text <> '[]' AND a.bookings::text <> 'null'
    `);

    const now = Date.now();

    for (const row of res.rows) {
      let bookings = [];
      try { bookings = typeof row.bookings === 'string' ? JSON.parse(row.bookings) : (row.bookings || []); } catch { continue; }
      if (!bookings.length) continue;

      let changed = false;
      for (const b of bookings) {
        if (b.status && b.status !== 'confirmed') continue;
        const when = parseBookingDateTime(b);
        if (!when) continue;

        const msUntil = when.getTime() - now;
        b.reminders_sent = b.reminders_sent || [];

        // WhatsApp JID: prefer explicit customer_phone (if user provided another number),
        // else use session_id (the number they texted from).
        let jid = b.customer_jid || b.session_id || '';
        if (!jid && b.customer_phone) {
          const digits = String(b.customer_phone).replace(/\D/g, '');
          if (digits) jid = `${digits}@s.whatsapp.net`;
        }
        if (!jid) continue;

        const businessName = row.business_name || 'us';
        const { notifyOwner } = require('../services/owner-notify');
        const ownerSummary = (kind) => {
          const when = `${b.date} at ${b.time}`;
          const who = b.customer_name || 'Customer';
          const extra = b.service || b.package || '';
          const head = kind === '1d' ? '📅 Reminder: booking tomorrow' : '⏰ Reminder: booking in ~1 hour';
          return `${head}\n${who} — ${when}${extra ? `\n${extra}` : ''}\nBot: ${businessName}`;
        };

        // 1-day reminder window: between 24h10m and 23h50m before the appointment
        if (!b.reminders_sent.includes('1d') && msUntil > 0 && Math.abs(msUntil - 24 * 60 * 60 * 1000) <= WINDOW_MS) {
          const ok = await sendWhatsAppReminder(row.user_id, jid, reminderMessage('1d', b, businessName));
          if (ok) { b.reminders_sent.push('1d'); changed = true; }
          notifyOwner(row.user_id, ownerSummary('1d')).catch(() => {});
        }

        // 1-hour reminder window: between 1h10m and 50m before
        if (!b.reminders_sent.includes('1h') && msUntil > 0 && Math.abs(msUntil - 60 * 60 * 1000) <= WINDOW_MS) {
          const ok = await sendWhatsAppReminder(row.user_id, jid, reminderMessage('1h', b, businessName));
          if (ok) { b.reminders_sent.push('1h'); changed = true; }
          notifyOwner(row.user_id, ownerSummary('1h')).catch(() => {});
        }
      }

      if (changed) {
        await query(
          'UPDATE agents SET bookings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [JSON.stringify(bookings), row.agent_id]
        );
      }
    }
  } catch (e) {
    console.error('[reminder] processOnce error:', e.message);
  }
}

function start() {
  console.log(`[reminder] Booking reminder worker starting (poll every ${POLL_INTERVAL_MS / 1000}s)`);
  processOnce();
  setInterval(processOnce, POLL_INTERVAL_MS);
}

module.exports = { start, processOnce };
