const { query } = require('../config/database');

class Chat {
  static async saveMessage({ user_id, session_id, role, content, model, tokens }) {
    const id = require('crypto').randomUUID();
    const result = await query(
      `INSERT INTO chat_messages (id, user_id, session_id, role, content, model, tokens, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, user_id, session_id, role, content, model || null, tokens || null]
    );
    return result.rows[0];
  }

  static async getChatHistory(userId, limit = 50) {
    const result = await query(
      `SELECT id, session_id, role, content, model, tokens, created_at 
       FROM chat_messages 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.reverse(); // Return in chronological order
  }

  static async clearChatHistory(userId) {
    const result = await query(
      `DELETE FROM chat_messages WHERE user_id = $1`,
      [userId]
    );
    return result.rowCount;
  }

  static async getSessionHistory(userId, sessionId, limit = 10) {
    const result = await query(
      `SELECT role, content FROM chat_messages
       WHERE user_id = $1 AND session_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [userId, sessionId, limit]
    );
    return result.rows.reverse();
  }

  // Check if bot is paused for a specific chat session
  static async isBotPaused(userId, sessionId) {
    // Store pause state in a simple convention: a message with role='system' and content='BOT_PAUSED'
    const result = await query(
      `SELECT content FROM chat_messages WHERE user_id = $1 AND session_id = $2 AND role = 'system' ORDER BY created_at DESC LIMIT 1`,
      [userId, sessionId]
    );
    return result.rows[0]?.content === 'BOT_PAUSED';
  }

  static async setBotPaused(userId, sessionId, paused) {
    const id = require('crypto').randomUUID();
    await query(
      `INSERT INTO chat_messages (id, user_id, session_id, role, content, created_at)
       VALUES ($1, $2, $3, 'system', $4, CURRENT_TIMESTAMP)`,
      [id, userId, sessionId, paused ? 'BOT_PAUSED' : 'BOT_RESUMED']
    );
  }

  static async getSessions(userId) {
    const result = await query(
      `SELECT DISTINCT session_id, MAX(created_at) as last_message 
       FROM chat_messages 
       WHERE user_id = $1 
       GROUP BY session_id 
       ORDER BY last_message DESC`,
      [userId]
    );
    return result.rows;
  }
}

module.exports = Chat;
