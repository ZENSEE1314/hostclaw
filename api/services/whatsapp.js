// WhatsApp session manager using @whiskeysockets/baileys
// Sessions are in-memory — users re-scan QR after server restart

const QRCode = require('qrcode');

// Active sessions: userId -> { status, qrDataUrl, connected, socket }
const sessions = new Map();

// Lazy-load Baileys (ESM-only package in newer versions)
let baileysCache = null;
async function getBaileys() {
  if (baileysCache) return baileysCache;
  baileysCache = await import('@whiskeysockets/baileys');
  return baileysCache;
}

async function createSession(userId, onConnected, onMessage) {
  // Clean up any existing session
  const existing = sessions.get(userId);
  if (existing?.socket) {
    try { existing.socket.end(undefined); } catch (e) {}
  }

  const session = { status: 'connecting', qrDataUrl: null, connected: false, socket: null };
  sessions.set(userId, session);

  try {
    const {
      default: makeWASocket,
      DisconnectReason,
      fetchLatestBaileysVersion,
      initAuthCreds,
      proto
    } = await getBaileys();

    const { Boom } = await import('@hapi/boom');

    // Get latest WhatsApp version
    let version;
    try {
      const v = await fetchLatestBaileysVersion();
      version = v.version;
    } catch (e) {
      version = [2, 3000, 1015901307]; // fallback version
    }

    // Simple in-memory auth state
    let creds = initAuthCreds();
    const keys = {};

    const sock = makeWASocket({
      version,
      auth: {
        creds,
        keys: {
          get: async (type, ids) => {
            const data = {};
            for (const id of ids) {
              const val = keys[`${type}-${id}`];
              if (val) {
                data[id] = type === 'app-state-sync-key'
                  ? proto.Message.AppStateSyncKeyData.fromObject(val)
                  : val;
              }
            }
            return data;
          },
          set: async (data) => {
            for (const cat of Object.keys(data)) {
              for (const id of Object.keys(data[cat])) {
                const key = `${cat}-${id}`;
                if (data[cat][id]) keys[key] = data[cat][id];
                else delete keys[key];
              }
            }
          }
        }
      },
      printQRInTerminal: false,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      generateHighQualityLinkPreview: false
    });

    session.socket = sock;

    sock.ev.on('creds.update', (update) => { Object.assign(creds, update); });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          session.qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
          session.status = 'qr';
        } catch (e) {
          console.error('QR generate error:', e);
        }
      }

      if (connection === 'open') {
        session.status = 'connected';
        session.connected = true;
        session.qrDataUrl = null;
        const phoneNumber = (sock.user?.id || '').split(':')[0].split('@')[0];
        try {
          await onConnected(phoneNumber, sock.user?.name || phoneNumber);
        } catch (e) {
          console.error('onConnected error:', e);
        }
      }

      if (connection === 'close') {
        const code = (new Boom(lastDisconnect?.error))?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          session.status = 'disconnected';
          sessions.delete(userId);
        } else {
          session.status = 'reconnecting';
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption;
        if (!text) continue;
        try {
          await onMessage(msg.key.remoteJid, text, sock);
        } catch (e) {
          console.error('WhatsApp message handler error:', e);
        }
      }
    });

  } catch (error) {
    console.error('WhatsApp session create error:', error);
    sessions.delete(userId);
    throw error;
  }

  return session;
}

function getSession(userId) {
  return sessions.get(userId);
}

function deleteSession(userId) {
  const s = sessions.get(userId);
  if (s?.socket) {
    try { s.socket.end(undefined); } catch (e) {}
  }
  sessions.delete(userId);
}

module.exports = { createSession, getSession, deleteSession };
