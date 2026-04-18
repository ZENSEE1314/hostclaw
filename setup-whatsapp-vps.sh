#!/bin/bash
# ChatsAI WhatsApp VPS Setup Script
# Run on a fresh Ubuntu 24.04 DigitalOcean droplet
# Usage: curl -sL https://raw.githubusercontent.com/ZENSEE1314/hostclaw/main/setup-whatsapp-vps.sh | bash

set -e

echo "========================================="
echo "  ChatsAI WhatsApp Bot - VPS Setup"
echo "========================================="

# 1. Install Node.js 22
echo ">> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "Node.js $(node -v) installed"

# 2. Install PM2 for process management
echo ">> Installing PM2..."
npm install -g pm2
echo "PM2 installed"

# 3. Create app directory
echo ">> Setting up app..."
mkdir -p /opt/chatsai-whatsapp
cd /opt/chatsai-whatsapp

# 4. Create package.json
cat > package.json << 'PKGJSON'
{
  "name": "chatsai-whatsapp-bot",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.18",
    "@hapi/boom": "^10.0.1",
    "qrcode": "^1.5.3",
    "express": "^4.18.2",
    "axios": "^1.6.2"
  }
}
PKGJSON

# 5. Install dependencies
echo ">> Installing dependencies..."
npm install
echo "Dependencies installed"

# 6. Create the WhatsApp bridge server
cat > server.mjs << 'SERVERMJS'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, proto, Browsers, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import express from 'express';
import axios from 'axios';
import QRCode from 'qrcode';
import fs from 'fs';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const RAILWAY_API = process.env.RAILWAY_API || 'https://hostclaw-production-8e47.up.railway.app';

// Store sessions per user
const sessions = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, uptime: process.uptime() });
});

// Start WhatsApp session for a user
app.post('/session/start', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // Clean up existing session
    const existing = sessions.get(userId);
    if (existing?.socket) {
      try { existing.socket.end(undefined); } catch(e) {}
    }

    const authDir = `./auth/${userId}`;
    fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    const session = { status: 'connecting', qrDataUrl: null, connected: false, socket: null };
    sessions.set(userId, session);

    const sock = makeWASocket({
      version,
      browser: Browsers.ubuntu('Chrome'),
      auth: state,
      printQRInTerminal: true,
      syncFullHistory: false,
      connectTimeoutMs: 120000,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined
    });

    session.socket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
        session.status = 'qr';
        console.log(`[${userId}] QR code generated`);
      }

      if (connection === 'open') {
        session.status = 'connected';
        session.connected = true;
        session.qrDataUrl = null;
        const phone = (sock.user?.id || '').split(':')[0].split('@')[0];
        console.log(`[${userId}] Connected! Phone: ${phone}`);

        // Notify Railway API
        try {
          await axios.post(`${RAILWAY_API}/api/platforms/whatsapp/vps-connected`, {
            userId, phoneNumber: phone, name: sock.user?.name || phone
          }, { timeout: 10000 }).catch(() => {});
        } catch(e) {}
      }

      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          console.log(`[${userId}] Logged out — clearing auth, user must re-scan QR`);
          sessions.delete(userId);
          fs.rmSync(authDir, { recursive: true, force: true });
        } else {
          // Connection dropped, not logged out — reconnect automatically using saved auth
          console.log(`[${userId}] Disconnected (code ${code}), reconnecting in 5s...`);
          setTimeout(async () => {
            try {
              sessions.delete(userId);
              // Re-start the session using the same auth files
              await axios.post(`http://localhost:${PORT}/session/start`, { userId }).catch(() => {});
              console.log(`[${userId}] Reconnect initiated`);
            } catch (e) {
              console.error(`[${userId}] Reconnect failed:`, e.message);
            }
          }, 5000);
        }
      }
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption;
        if (!text) continue;

        console.log(`[${userId}] Message from ${msg.key.remoteJid}: ${text.substring(0, 50)}`);

        // Forward to API for AI processing. Try hard to get the real phone:
        //   1. senderPn / participantPn are set by newer Baileys for @lid messages
        //   2. Fallback: parse phone from the JID itself for @s.whatsapp.net
        try {
          const aiRes = await axios.post(`${RAILWAY_API}/api/chat/whatsapp-webhook`, {
            userId,
            from: msg.key.remoteJid,
            senderPn: msg.key.senderPn || '',
            participantPn: msg.key.participantPn || '',
            pushName: msg.pushName || '',
            participant: msg.key.participant || '',
            text,
            messageId: msg.key.id
          }, { timeout: 30000 });

          if (aiRes.data?.reply) {
            await sock.sendMessage(msg.key.remoteJid, { text: aiRes.data.reply });
            console.log(`[${userId}] Replied to ${msg.key.remoteJid}`);
          }
        } catch(e) {
          console.error(`[${userId}] AI reply error:`, e.message);
        }
      }
    });

    res.json({ message: 'Session started', userId });
  } catch (error) {
    console.error(`[${userId}] Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get QR code / status
app.get('/session/:userId/qr', (req, res) => {
  const session = sessions.get(req.params.userId);
  if (!session) return res.json({ status: 'not_started' });
  res.json({
    status: session.status,
    qrDataUrl: session.qrDataUrl,
    connected: session.connected
  });
});

// Send message
app.post('/session/:userId/send', async (req, res) => {
  const session = sessions.get(req.params.userId);
  if (!session?.socket) return res.status(400).json({ error: 'No active session' });
  const { to, text } = req.body;
  try {
    await session.socket.sendMessage(to, { text });
    res.json({ sent: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete session
app.delete('/session/:userId', (req, res) => {
  const session = sessions.get(req.params.userId);
  if (session?.socket) {
    try { session.socket.end(undefined); } catch(e) {}
  }
  sessions.delete(req.params.userId);
  res.json({ deleted: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ChatsAI WhatsApp Bridge running on port ${PORT}`);
  console.log(`Railway API: ${RAILWAY_API}`);
});
SERVERMJS

# 7. Start with PM2
echo ">> Starting WhatsApp bridge..."
RAILWAY_API="https://hostclaw-production-8e47.up.railway.app" pm2 start server.mjs --name chatsai-whatsapp
pm2 save
pm2 startup | tail -1 | bash

# 8. Open firewall
echo ">> Configuring firewall..."
ufw allow 22/tcp
ufw allow 3001/tcp
ufw --force enable

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  WhatsApp Bridge: http://$(curl -s ifconfig.me):3001"
echo "  Health Check:    http://$(curl -s ifconfig.me):3001/health"
echo ""
echo "  To start a QR session:"
echo "    curl -X POST http://$(curl -s ifconfig.me):3001/session/start -H 'Content-Type: application/json' -d '{\"userId\":\"YOUR_USER_ID\"}'"
echo ""
echo "  PM2 commands:"
echo "    pm2 logs chatsai-whatsapp  - View logs"
echo "    pm2 restart chatsai-whatsapp - Restart"
echo "    pm2 status - Check status"
echo ""
