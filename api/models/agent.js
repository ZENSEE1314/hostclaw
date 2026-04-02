const { query } = require('../config/database');

class Agent {
  static async create({ userId, name, description, model, channels, config = {}, system_prompt, bot_type, business_name, knowledge_base }) {
    const id = require('crypto').randomUUID();
    const result = await query(
      `INSERT INTO agents (id, user_id, name, description, model, channels, config, system_prompt, bot_type, business_name, knowledge_base)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [id, userId, name, description, model, JSON.stringify(channels), JSON.stringify(config),
       system_prompt || null, bot_type || 'personal', business_name || null, JSON.stringify(knowledge_base || [])]
    );
    return this.formatAgent(result.rows[0]);
  }

  static async findByUser(userId) {
    const result = await query(
      `SELECT * FROM agents WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map(agent => this.formatAgent(agent));
  }

  static async findById(id, userId) {
    const result = await query(
      `SELECT * FROM agents WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return result.rows[0] ? this.formatAgent(result.rows[0]) : null;
  }

  static async update(id, userId, updates) {
    const allowedFields = ['name', 'description', 'model', 'channels', 'config', 'system_prompt', 'bot_type', 'business_name', 'knowledge_base'];
    const setClause = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramCount}`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
        paramCount++;
      }
    }

    if (setClause.length === 0) return null;

    values.push(id, userId);
    const result = await query(
      `UPDATE agents SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $${paramCount} AND user_id = $${paramCount + 1} 
       RETURNING *`,
      values
    );
    return result.rows[0] ? this.formatAgent(result.rows[0]) : null;
  }

  static async delete(id, userId) {
    const result = await query(
      'DELETE FROM agents WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return result.rowCount > 0;
  }

  static async updateStatus(id, status, deploymentInfo = {}) {
    const { url, deploymentId, containerId } = deploymentInfo;
    const result = await query(
      `UPDATE agents 
       SET status = $1, 
           deployment_url = COALESCE($2, deployment_url),
           deployment_id = COALESCE($3, deployment_id),
           container_id = COALESCE($4, container_id),
           last_deployed_at = CASE WHEN $1 = 'running' THEN CURRENT_TIMESTAMP ELSE last_deployed_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 
       RETURNING *`,
      [status, url, deploymentId, containerId, id]
    );
    return result.rows[0] ? this.formatAgent(result.rows[0]) : null;
  }

  static async incrementMessageCount(id) {
    await query(
      'UPDATE agents SET message_count = message_count + 1 WHERE id = $1',
      [id]
    );
  }

  static formatAgent(agent) {
    const parseJson = (val, fallback) => {
      if (!val) return fallback;
      if (typeof val === 'object') return val;
      try { return JSON.parse(val); } catch { return fallback; }
    };
    return {
      ...agent,
      channels: parseJson(agent.channels, []),
      config: parseJson(agent.config, {}),
      knowledge_base: parseJson(agent.knowledge_base, [])
    };
  }

  // Find agent by user ID without requiring userId check (for webhook lookups)
  static async findByIdOnly(id) {
    const result = await query('SELECT * FROM agents WHERE id = $1', [id]);
    return result.rows[0] ? this.formatAgent(result.rows[0]) : null;
  }

  // Find first agent for a user (default agent for platform messages)
  static async findDefaultForUser(userId) {
    const result = await query(
      `SELECT * FROM agents WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [userId]
    );
    return result.rows[0] ? this.formatAgent(result.rows[0]) : null;
  }
}

module.exports = Agent;