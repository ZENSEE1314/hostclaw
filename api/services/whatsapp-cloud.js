// WhatsApp Business Cloud API service
// Uses Meta's official Graph API — no WebSocket needed, works on Railway

const axios = require('axios');

const GRAPH_API = 'https://graph.facebook.com/v21.0';

async function sendTextMessage(phoneNumberId, accessToken, to, text) {
  const url = `${GRAPH_API}/${phoneNumberId}/messages`;
  const response = await axios.post(url, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text }
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  return response.data;
}

async function sendTemplateMessage(phoneNumberId, accessToken, to, templateName, languageCode = 'en_US') {
  const url = `${GRAPH_API}/${phoneNumberId}/messages`;
  const response = await axios.post(url, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode }
    }
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  return response.data;
}

async function markAsRead(phoneNumberId, accessToken, messageId) {
  const url = `${GRAPH_API}/${phoneNumberId}/messages`;
  await axios.post(url, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  }).catch(() => {});
}

async function verifyToken(accessToken) {
  const url = `${GRAPH_API}/me?access_token=${accessToken}`;
  const response = await axios.get(url, { timeout: 10000 });
  return response.data;
}

async function getPhoneNumberInfo(phoneNumberId, accessToken) {
  const url = `${GRAPH_API}/${phoneNumberId}`;
  const response = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
    timeout: 10000
  });
  return response.data;
}

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  markAsRead,
  verifyToken,
  getPhoneNumberInfo
};
