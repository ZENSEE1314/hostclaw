const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async createUser({ email, password, name, plan = 'starter', credits = 20 }) {
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password, name, plan, credits, has_paid, api_providers, skills, default_provider) 
       VALUES ($1, $2, $3, $4, $5, false, '{}', '[]', 'openai') 
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

  // API Provider methods
  static async updateApiProvider(userId, provider, config) {
    const result = await query(
      `UPDATE users 
       SET api_providers = jsonb_set(COALESCE(api_providers, '{}'), array[$1], $2::jsonb),
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3 
       RETURNING api_providers`,
      [provider, JSON.stringify(config), userId]
    );
    return result.rows[0]?.api_providers;
  }

  static async deactivateApiProvider(userId, provider) {
    const result = await query(
      `UPDATE users 
       SET api_providers = api_providers - $1,
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING api_providers`,
      [provider, userId]
    );
    return result.rows[0]?.api_providers;
  }

  static async setDefaultProvider(userId, provider) {
    const result = await query(
      `UPDATE users 
       SET default_provider = $1,
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING default_provider`,
      [provider, userId]
    );
    return result.rows[0]?.default_provider;
  }

  // Skills methods
  static async addSkill(userId, skill) {
    const result = await query(
      `UPDATE users 
       SET skills = COALESCE(skills, '[]'::jsonb) || $1::jsonb,
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING skills`,
      [JSON.stringify([skill]), userId]
    );
    return result.rows[0]?.skills;
  }

  static async removeSkill(userId, skillId) {
    const result = await query(
      `UPDATE users 
       SET skills = COALESCE(
         (SELECT jsonb_agg(elem) FROM jsonb_array_elements(skills) elem WHERE elem->>'id' != $1),
         '[]'::jsonb
       ),
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING skills`,
      [skillId, userId]
    );
    return result.rows[0]?.skills;
  }

  static async toggleSkill(userId, skillId) {
    const result = await query(
      `UPDATE users 
       SET skills = (
         SELECT jsonb_agg(
           CASE 
             WHEN elem->>'id' = $1 THEN elem || '{"active": "false"}'::jsonb
             ELSE elem
           END
         )
         FROM jsonb_array_elements(skills) elem
       ),
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING skills`,
      [skillId, userId]
    );
    return result.rows[0]?.skills;
  }

  static async updateSkillConfig(userId, skillId, config) {
    const result = await query(
      `UPDATE users 
       SET skills = (
         SELECT jsonb_agg(
           CASE 
             WHEN elem->>'id' = $1 THEN elem || jsonb_build_object('config', $2::jsonb)
             ELSE elem
           END
         )
         FROM jsonb_array_elements(skills) elem
       ),
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3 
       RETURNING skills`,
      [skillId, JSON.stringify(config), userId]
    );
    return result.rows[0]?.skills;
  }

  // Mark user as paid
  static async markAsPaid(userId) {
    const result = await query(
      `UPDATE users 
       SET has_paid = true, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [userId]
    );
    return result.rows[0];
  }

  // Platform connection methods
  static async updatePlatform(userId, platform, config) {
    const result = await query(
      `UPDATE users 
       SET platforms = jsonb_set(COALESCE(platforms, '{}'), array[$1], $2::jsonb),
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3 
       RETURNING platforms`,
      [platform, JSON.stringify(config), userId]
    );
    return result.rows[0]?.platforms;
  }

  static async removePlatform(userId, platform) {
    const result = await query(
      `UPDATE users 
       SET platforms = platforms - $1,
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING platforms`,
      [platform, userId]
    );
    return result.rows[0]?.platforms;
  }

  // Find user by platform ID (for webhook routing)
  static async findByPlatform(platform, platformUserId) {
    const result = await query(
      `SELECT * FROM users 
       WHERE platforms->${platform}->>'user_id' = $1 
       LIMIT 1`,
      [platformUserId]
    );
    return result.rows[0];
  }

  // ===== FORGOT PASSWORD METHODS =====
  
  static async setResetToken(userId, token, expiresAt) {
    const result = await query(
      `UPDATE users 
       SET reset_token = $1, reset_token_expires = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3 
       RETURNING *`,
      [token, expiresAt, userId]
    );
    return result.rows[0];
  }

  static async findByResetToken(token) {
    const result = await query(
      `SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );
    return result.rows[0];
  }

  static async clearResetToken(userId) {
    const result = await query(
      `UPDATE users 
       SET reset_token = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [userId]
    );
    return result.rows[0];
  }

  static async updatePassword(userId, hashedPassword) {
    const result = await query(
      `UPDATE users 
       SET password = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [hashedPassword, userId]
    );
    return result.rows[0];
  }

  // Check if user is admin (first user or has admin email)
  static async isAdmin(userId) {
    const user = await this.findById(userId);
    if (!user) return false;
    
    // First user is admin
    const firstUser = await query('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
    if (firstUser.rows[0]?.id === userId) return true;
    
    // Or check admin email list
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim());
    return adminEmails.includes(user.email);
  }
}

module.exports = User;