const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async createUser({ email, password, name, plan = 'starter', credits = 10, has_paid = false, referral_code = null, applied_coupon = null, my_referral_code = null, referred_by = null }) {
    // Normalize email to lowercase
    const normalizedEmail = email.toLowerCase().trim();
    
    console.log('Creating user with email:', normalizedEmail);
    
    // Password is already hashed by the caller (auth.js)
    // DO NOT hash it again here!
    const userId = require('crypto').randomUUID();
    
    try {
      await query(
        `INSERT INTO users (id, email, password, name, plan, credits, has_paid, referral_code, applied_coupon, my_referral_code, referred_by, api_providers, skills, default_provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '{}', '[]', 'openai')`,
        [userId, normalizedEmail, password, name, plan, credits, has_paid ? 1 : 0, referral_code, applied_coupon, my_referral_code, referred_by]
      );
      
      // Fetch the created user
      const result = await query(
        'SELECT id, email, name, plan, credits, has_paid, created_at FROM users WHERE id = $1',
        [userId]
      );
      
      if (!result.rows[0]) {
        console.error('ERROR: User inserted but not found when fetching! ID:', userId);
        throw new Error('User creation verification failed');
      }
      
      console.log('User created successfully:', result.rows[0].id);
      return result.rows[0];
    } catch (err) {
      console.error('Error creating user:', err.message);
      throw err;
    }
  }

  static async findByEmail(email) {
    if (!email) return null;
    
    // Normalize email to lowercase
    const normalizedEmail = email.toLowerCase().trim();
    
    console.log('Looking up user by email:', normalizedEmail);
    
    try {
      // Use SQLite with case-insensitive comparison
      const result = await query(
        'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
        [normalizedEmail]
      );
      
      const user = result.rows[0] || null;
      console.log('User lookup result:', user ? `Found user ${user.id}` : 'Not found');
      return user;
    } catch (err) {
      console.error('Error finding user:', err.message);
      return null;
    }
  }

  static async findById(id) {
    const result = await query(
      'SELECT id, email, name, plan, credits, has_paid, api_providers, skills, platforms, default_provider, stripe_customer_id, stripe_subscription_id, gateway_config, my_referral_code, referred_by, message_count, message_limit, plan_type, plan_expires_at, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async findByMyReferralCode(code) {
    const result = await query(
      'SELECT id, email, name, credits FROM users WHERE UPPER(my_referral_code) = UPPER($1)',
      [code]
    );
    return result.rows[0] || null;
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

  // Provider methods
  static async updateProviders(userId, providers) {
    const result = await query(
      `UPDATE users
       SET api_providers = $1,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING api_providers`,
      [JSON.stringify(providers), userId]
    );
    return result.rows[0]?.api_providers;
  }

  static async updateDefaultProvider(userId, provider) {
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

  // Helper: parse skills from user row (handles TEXT or object)
  static _parseSkills(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw); } catch (e) { return []; }
  }

  // Skills methods — all manipulate JSON in JS to avoid JSONB/TEXT type mismatch in PostgreSQL
  static async addSkill(userId, skill) {
    const user = await this.findById(userId);
    const skills = this._parseSkills(user.skills);
    if (!skills.find(s => s.id === skill.id)) {
      skills.push(skill);
    }
    const result = await query(
      `UPDATE users SET skills = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING skills`,
      [JSON.stringify(skills), userId]
    );
    return result.rows[0]?.skills;
  }

  static async removeSkill(userId, skillId) {
    const user = await this.findById(userId);
    const skills = this._parseSkills(user.skills).filter(s => s.id !== skillId);
    const result = await query(
      `UPDATE users SET skills = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING skills`,
      [JSON.stringify(skills), userId]
    );
    return result.rows[0]?.skills;
  }

  static async toggleSkill(userId, skillId) {
    const user = await this.findById(userId);
    const skills = this._parseSkills(user.skills).map(s =>
      s.id === skillId ? { ...s, active: !s.active } : s
    );
    const result = await query(
      `UPDATE users SET skills = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING skills`,
      [JSON.stringify(skills), userId]
    );
    return result.rows[0]?.skills;
  }

  static async updateSkillConfig(userId, skillId, config) {
    const user = await this.findById(userId);
    const skills = this._parseSkills(user.skills).map(s =>
      s.id === skillId ? { ...s, config } : s
    );
    const result = await query(
      `UPDATE users SET skills = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING skills`,
      [JSON.stringify(skills), userId]
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

  // Helper: parse platforms from TEXT column
  static _parsePlatforms(raw) {
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }

  // Platform connection methods
  static async updatePlatform(userId, platform, config) {
    const user = await this.findById(userId);
    const platforms = this._parsePlatforms(user.platforms);
    platforms[platform] = config;
    const result = await query(
      `UPDATE users SET platforms = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING platforms`,
      [JSON.stringify(platforms), userId]
    );
    return result.rows[0]?.platforms;
  }

  static async removePlatform(userId, platform) {
    const user = await this.findById(userId);
    const platforms = this._parsePlatforms(user.platforms);
    delete platforms[platform];
    const result = await query(
      `UPDATE users SET platforms = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING platforms`,
      [JSON.stringify(platforms), userId]
    );
    return result.rows[0]?.platforms;
  }

  // Find user by platform (for webhook routing) — scan in JS since platforms is TEXT
  static async findByPlatform(platform, identifier) {
    const result = await query(
      `SELECT id, email, name, plan, credits, has_paid, api_providers, skills, platforms, default_provider FROM users WHERE platforms IS NOT NULL AND platforms != '{}'`,
      []
    );
    for (const row of result.rows) {
      const platforms = this._parsePlatforms(row.platforms);
      const p = platforms[platform];
      if (p && (p.bot_username === identifier || p.phone_number === identifier || p.page_id === identifier)) {
        return row;
      }
    }
    return null;
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

  // ===== MESSAGE-BASED BILLING =====

  static canSendMessage(user) {
    if (!user) return false;
    const planType = user.plan_type || 'free';

    // Unlimited plan — check expiry
    if (planType === 'unlimited') {
      if (user.plan_expires_at && new Date(user.plan_expires_at) < new Date()) {
        return false; // expired
      }
      return true;
    }

    // Free or paid — check message count vs limit
    const count = parseInt(user.message_count) || 0;
    const limit = parseInt(user.message_limit) || 50;
    return count < limit;
  }

  static async deductMessage(userId) {
    // Try unlimited path first (atomic: checks plan_type and expiry in SQL)
    const unlimitedResult = await query(
      `UPDATE users SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND plan_type = 'unlimited' AND (plan_expires_at IS NULL OR plan_expires_at > CURRENT_TIMESTAMP)
       RETURNING message_count`,
      [userId]
    );
    if (unlimitedResult.rows.length > 0) return true;

    // For free/paid: atomic check-and-increment
    const result = await query(
      'UPDATE users SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND message_count < message_limit RETURNING message_count',
      [userId]
    );
    return result.rows.length > 0;
  }

  static async addMessages(userId, count, planType, expiresAt) {
    if (planType === 'unlimited') {
      await query(
        'UPDATE users SET plan_type = $1, plan_expires_at = $2, has_paid = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [planType, expiresAt, userId]
      );
    } else {
      // Top-up: add to message_limit
      await query(
        'UPDATE users SET message_limit = message_limit + $1, plan_type = $2, has_paid = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [count, planType || 'paid', userId]
      );
    }
  }

  static async getMessageBalance(userId) {
    const user = await this.findById(userId);
    if (!user) return null;
    const count = parseInt(user.message_count) || 0;
    const limit = parseInt(user.message_limit) || 50;
    const planType = user.plan_type || 'free';
    const isUnlimited = planType === 'unlimited';
    const expired = isUnlimited && user.plan_expires_at && new Date(user.plan_expires_at) < new Date();

    return {
      message_count: count,
      message_limit: isUnlimited ? null : limit,
      remaining: isUnlimited ? (expired ? 0 : -1) : Math.max(0, limit - count),
      plan_type: expired ? 'expired' : planType,
      plan_expires_at: user.plan_expires_at,
      is_unlimited: isUnlimited && !expired
    };
  }

  static async renewUnlimitedPlan(userId, durationDays) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    await query(
      'UPDATE users SET message_count = 0, plan_expires_at = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [expiresAt.toISOString(), userId]
    );
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

  // Add credits to user
  static async addCredits(userId, amount) {
    const result = await query(
      'UPDATE users SET credits = credits + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING credits',
      [amount, userId]
    );
    return result.rows[0]?.credits;
  }

  // Update payment status
  static async updatePaymentStatus(userId, status) {
    const result = await query(
      'UPDATE users SET has_paid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status === 'paid', userId]
    );
    return result.rows[0];
  }
}

module.exports = User;