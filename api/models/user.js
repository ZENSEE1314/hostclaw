const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async createUser({ email, password, name, plan = 'starter', credits = 20 }) {
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password, name, plan, credits) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, name, plan, credits, created_at`,
      [email, hashedPassword, name, plan, credits]
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await query(
      'SELECT id, email, name, plan, credits, stripe_customer_id, gateway_config, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async updateCredits(userId, amount) {
    const result = await query(
      'UPDATE users SET credits = credits + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING credits',
      [amount, userId]
    );
    return result.rows[0]?.credits;
  }

  static async updateStripeInfo(userId, { customerId, subscriptionId }) {
    const result = await query(
      'UPDATE users SET stripe_customer_id = $1, stripe_subscription_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [customerId, subscriptionId, userId]
    );
    return result.rowCount > 0;
  }

  static async updatePlan(userId, plan) {
    const result = await query(
      'UPDATE users SET plan = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [plan, userId]
    );
    return result.rows[0];
  }

  static async updateGatewayConfig(userId, config) {
    const result = await query(
      'UPDATE users SET gateway_config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(config), userId]
    );
    return result.rowCount > 0;
  }

  static async getAgentCount(userId) {
    const result = await query(
      'SELECT COUNT(*) FROM agents WHERE user_id = $1',
      [userId]
    );
    return parseInt(result.rows[0].count);
  }

  static async deductCredits(userId, amount) {
    const result = await query(
      'UPDATE users SET credits = credits - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND credits >= $1 RETURNING credits',
      [amount, userId]
    );
    return result.rows[0]?.credits;
  }
}

module.exports = User;