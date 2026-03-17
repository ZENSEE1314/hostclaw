const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Agent = require('../models/agent');
const { query } = require('../config/database');
const EmailService = require('../services/email');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Setup endpoint - create first admin (no auth required, only works if no users exist)
router.post('/setup', async (req, res) => {
  try {
    // Check if any users exist
    const userCount = await query('SELECT COUNT(*) as count FROM users');
    
    if (userCount.rows[0].count > 0) {
      return res.status(403).json({ error: 'Setup already complete. Users exist.' });
    }
    
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Create admin user
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = require('crypto').randomUUID();
    
    await query(
      `INSERT INTO users (id, email, password, name, plan, credits, has_paid, api_providers, skills, default_provider) 
       VALUES ($1, $2, $3, $4, $5, $6, 1, '{}', '[]', 'openai')`,
      [userId, email.toLowerCase(), hashedPassword, name || 'Admin', 'enterprise', 1000]
    );
    
    res.json({ 
      message: 'Admin user created successfully',
      email: email,
      userId: userId
    });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Setup failed' });
  }
});

// Debug endpoint - list all users (no auth required for debugging)
router.get('/debug/users', async (req, res) => {
  try {
    const users = await query('SELECT id, email, name, plan, credits, has_paid, created_at FROM users ORDER BY created_at DESC');
    res.json({ 
      count: users.rows.length,
      users: users.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset user password (no auth for now, just needs email)
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and newPassword required' });
    }
    
    // Find user
    const userResult = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userResult.rows[0].id]);
    
    res.json({ 
      message: 'Password reset successfully',
      email: email
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Reset ALL passwords to same value
router.post('/reset-all-passwords', async (req, res) => {
  try {
    const { newPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({ error: 'newPassword required' });
    }
    
    // Get all users
    const usersResult = await query('SELECT id, email FROM users');
    
    // Update each user's password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    let updatedCount = 0;
    
    for (const user of usersResult.rows) {
      await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
      console.log('Updated password for:', user.email);
      updatedCount++;
    }
    
    res.json({ 
      message: 'All passwords reset successfully',
      count: updatedCount,
      newPassword: newPassword
    });
  } catch (err) {
    console.error('Reset all passwords error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Debug: Check password for a user
router.get('/debug/password/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const userResult = await query('SELECT id, email, password FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const testPassword = 'abc123';
    const bcrypt = require('bcryptjs');
    const isValid = await bcrypt.compare(testPassword, user.password);
    
    res.json({
      email: user.email,
      passwordHash: user.password.substring(0, 20) + '...',
      hashLength: user.password.length,
      testWithAbc123: isValid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin middleware
const requireAdmin = async (req, res, next) => {
  // In production, check if user has admin role
  // For now, allow all authenticated users (implement proper RBAC)
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

router.use(authenticate, requireAdmin);

// Dashboard stats
router.get('/stats', async (req, res, next) => {
  try {
    // User stats
    const userStats = await query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN plan = 'starter' THEN 1 END) as starter_users,
        COUNT(CASE WHEN plan = 'pro' THEN 1 END) as pro_users,
        COUNT(CASE WHEN plan = 'enterprise' THEN 1 END) as enterprise_users,
        COUNT(CASE WHEN has_paid = 1 THEN 1 END) as paid_users
      FROM users
    `);

    // Agent stats
    const agentStats = await query(`
      SELECT 
        COUNT(*) as total_agents,
        COUNT(CASE WHEN status = 'running' THEN 1 END) as running_agents,
        SUM(message_count) as total_messages
      FROM agents
    `);

    // Revenue stats
    const revenueStats = await query(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN amount END), 0) as revenue_30d,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN amount END), 0) as revenue_7d
      FROM invoices
      WHERE status = 'paid'
    `);

    // Recent activity
    const recentUsers = await query(`
      SELECT id, name, email, plan, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 5
    `);

    const recentAgents = await query(`
      SELECT a.id, a.name, a.status, a.created_at, u.name as user_name
      FROM agents a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 5
    `);

    res.json({
      users: userStats.rows[0],
      agents: agentStats.rows[0],
      revenue: revenueStats.rows[0],
      recent: {
        users: recentUsers.rows,
        agents: recentAgents.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// List all users
router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = '', plan = '' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (search) {
      whereClause += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (plan) {
      whereClause += ` AND plan = $${paramCount}`;
      params.push(plan);
      paramCount++;
    }

    const users = await query(`
      SELECT id, name, email, plan, credits, has_paid, created_at,
        (SELECT COUNT(*) FROM agents WHERE user_id = users.id) as agent_count
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `, [...params, limit, offset]);

    const countResult = await query(`
      SELECT COUNT(*) FROM users ${whereClause}
    `, params);

    res.json({
      users: users.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user details
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await query(`
      SELECT id, name, email, plan, credits, stripe_customer_id, created_at
      FROM users WHERE id = $1
    `, [req.params.id]);

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const agents = await query(`
      SELECT id, name, status, message_count, created_at
      FROM agents WHERE user_id = $1
    `, [req.params.id]);

    const invoices = await query(`
      SELECT id, amount, status, description, created_at, paid_at
      FROM invoices WHERE user_id = $1
      ORDER BY created_at DESC
    `, [req.params.id]);

    res.json({
      user: user.rows[0],
      agents: agents.rows,
      invoices: invoices.rows
    });
  } catch (error) {
    next(error);
  }
});

// Update user
router.patch('/users/:id', async (req, res, next) => {
  try {
    const { plan, credits } = req.body;
    
    if (plan) {
      await User.updatePlan(req.params.id, plan);
    }
    
    if (credits !== undefined) {
      await User.updateCredits(req.params.id, credits);
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    next(error);
  }
});

// Update user (PUT for full update including has_paid)
router.put('/users/:id', async (req, res, next) => {
  try {
    const { name, plan, credits, has_paid } = req.body;
    
    console.log('Admin updating user:', req.params.id, { name, plan, credits, has_paid });
    
    // Update user fields
    if (name || plan || credits !== undefined || has_paid !== undefined) {
      const updates = [];
      const params = [];
      let paramCount = 1;
      
      if (name) {
        updates.push(`name = $${paramCount}`);
        params.push(name);
        paramCount++;
      }
      
      if (plan) {
        updates.push(`plan = $${paramCount}`);
        params.push(plan);
        paramCount++;
      }
      
      if (credits !== undefined) {
        updates.push(`credits = $${paramCount}`);
        params.push(credits);
        paramCount++;
      }
      
      if (has_paid !== undefined) {
        updates.push(`has_paid = $${paramCount}`);
        params.push(has_paid ? 1 : 0);
        paramCount++;
      }
      
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(req.params.id);
      
      const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`;
      console.log('Update SQL:', sql);
      
      await query(sql, params);
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    next(error);
  }
});

// List all agents
router.get('/agents', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = '' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (status) {
      whereClause += ` AND a.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    const agents = await query(`
      SELECT a.id, a.name, a.status, a.model, a.channels, a.message_count, 
             a.created_at, u.name as user_name, u.email as user_email
      FROM agents a
      JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `, [...params, limit, offset]);

    const countResult = await query(`
      SELECT COUNT(*) FROM agents a ${whereClause}
    `, params);

    res.json({
      agents: agents.rows.map(a => ({
        ...a,
        channels: typeof a.channels === 'string' ? JSON.parse(a.channels) : a.channels
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// System health
router.get('/health', async (req, res, next) => {
  try {
    // Check database
    const dbHealth = await query('SELECT 1').then(() => 'healthy').catch(() => 'unhealthy');
    
    // Check recent errors
    const recentErrors = await query(`
      SELECT COUNT(*) as count
      FROM deployments
      WHERE status = 'failed' AND started_at >= NOW() - INTERVAL '24 hours'
    `);

    res.json({
      database: dbHealth,
      recent_errors: parseInt(recentErrors.rows[0].count),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// Send announcement email
router.post('/announce', async (req, res, next) => {
  try {
    const { subject, message, target = 'all' } = req.body;

    let users;
    if (target === 'all') {
      users = await query('SELECT email, name FROM users');
    } else {
      users = await query('SELECT email, name FROM users WHERE plan = $1', [target]);
    }

    // Send emails in batches
    const batchSize = 50;
    for (let i = 0; i < users.rows.length; i += batchSize) {
      const batch = users.rows.slice(i, i + batchSize);
      await Promise.all(batch.map(user => 
        EmailService.send({
          to: user.email,
          subject,
          html: `
            <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #f8fafc; background: #0a0a1a; padding: 40px; border-radius: 20px;">
              <h1>${subject}</h1>
              <p>Hi ${user.name},</p>
              <div style="line-height: 1.7;">${message}</div>
            </div>
          `
        })
      ));
    }

    res.json({ 
      message: 'Announcement sent',
      recipients: users.rows.length 
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;