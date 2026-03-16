const { query } = require('../config/database');

class Agent {
  static async create({ userId, name, description, model, channels, config = {} }) {
    const result = await query(
      `INSERT INTO agents (user_id, name, description, model, channels, config) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [userId, name, description, model, JSON.stringify(channels), JSON.stringify(config)]
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
    const allowedFields = ['name', 'description', 'model', 'channels', 'config'];
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
    return {
      ...agent,
      channels: typeof agent.channels === 'string' ? JSON.parse(agent.channels) : agent.channels,
      config: typeof agent.config === 'string' ? JSON.parse(agent.config) : agent.config
    };
  }
}

module.exports = Agent;