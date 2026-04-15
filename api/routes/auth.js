const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/user');
const EmailService = require('../services/email');
const { authenticate } = require('../middleware/auth');
const crypto = require('crypto');
const axios = require('axios');

const router = express.Router();

// Google OAuth configuration - read fresh each time
function getGoogleConfig() {
  // Must use the API URL for the callback, not frontend
  const apiUrl = process.env.API_URL || process.env.FRONTEND_URL?.replace('-web', '-api');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${apiUrl}/api/auth/google/callback`;
  
  console.log('Google OAuth redirectUri:', redirectUri);
  
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  };
}

// Generate a unique 6-char referral code
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty()
], async (req, res, next) => {
  try {
    console.log('Register attempt:', req.body.email);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, referralCode } = req.body;

    // Check if user exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Resolve referrer
    let referrer = null;
    if (referralCode) {
      referrer = await User.findByMyReferralCode(referralCode.toUpperCase().trim());
    }

    // Generate this user's own referral code
    const myReferralCode = generateReferralCode();

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with $10 free credits
    const user = await User.createUser({
      email,
      password: hashedPassword,
      name,
      plan: 'starter',
      credits: 10,
      has_paid: 0,
      referral_code: referrer ? referralCode.toUpperCase().trim() : null,
      my_referral_code: myReferralCode,
      referred_by: referrer ? referrer.id : null
    });

    console.log('Register: User created:', user.id);

    // Give referrer $5 bonus
    if (referrer) {
      await User.updateCredits(referrer.id, 5);
      console.log(`Referral bonus: +$5 to user ${referrer.id}`);
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    try {
      await EmailService.sendWelcomeEmail(user);
    } catch (e) {
      console.log('Welcome email not sent:', e.message);
    }

    res.status(201).json({
      message: 'Account created! $10 free credits added.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        credits: user.credits,
        my_referral_code: myReferralCode
      },
      freeCredits: 10
    });
  } catch (error) {
    console.error('Register error:', error);
    next(error);
  }
});

// Login
router.post('/login', async (req, res, next) => {
  try {
    console.log('Login attempt:', req.body.email);
    
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findByEmail(email);
    console.log('Login: User lookup result:', user ? 'Found' : 'Not found');
    
    if (!user) {
      console.log('Login: User not found for email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    console.log('Login: Checking password...');
    const isValidPassword = await bcrypt.compare(password, user.password);
    console.log('Login: Password valid:', isValidPassword);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    console.log('Login: Success for user:', user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        credits: user.credits
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    next(error);
  }
});

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const { token } = req.body;
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const newToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ token: newToken });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Get user profile
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        credits: user.credits,
        my_referral_code: user.my_referral_code,
        created_at: user.created_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const { query } = require('../config/database');
    await query('UPDATE users SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [name, req.user.userId]);
    res.json({ message: 'Profile updated' });
  } catch (error) { next(error); }
});

// Change password
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { query } = require('../config/database');
    const result = await query('SELECT password FROM users WHERE id = $1', [req.user.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });

    const isValid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!isValid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashed, req.user.userId]);
    res.json({ message: 'Password changed' });
  } catch (error) { next(error); }
});

// Delete account
router.delete('/account', authenticate, async (req, res, next) => {
  try {
    const { query } = require('../config/database');
    await query('DELETE FROM chat_messages WHERE user_id = $1', [req.user.userId]);
    await query('DELETE FROM agents WHERE user_id = $1', [req.user.userId]);
    await query('DELETE FROM sales_leads WHERE user_id = $1', [req.user.userId]);
    await query('DELETE FROM sales_followups WHERE user_id = $1', [req.user.userId]);
    await query('DELETE FROM scheduled_tasks WHERE user_id = $1', [req.user.userId]);
    await query('DELETE FROM users WHERE id = $1', [req.user.userId]);
    res.json({ message: 'Account deleted' });
  } catch (error) { next(error); }
});

// ===== FORGOT PASSWORD =====

// Request password reset
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return res.json({ message: 'If an account exists, a reset link has been sent' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    await User.setResetToken(user.id, resetToken, resetTokenExpiry);

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
    
    try {
      await EmailService.send({
        to: user.email,
        subject: 'Password Reset - ChatsAI',
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background: #0a0a1a; color: #f8fafc; border-radius: 20px;">
            <h1 style="color: #6366f1;">Password Reset</h1>
            <p>Hi ${user.name},</p>
            <p>You requested a password reset. Click the button below to reset your password:</p>
            <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #06b6d4); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0;">Reset Password</a>
            <p style="color: #94a3b8;">This link expires in 1 hour.</p>
            <p style="color: #94a3b8;">If you didn't request this, please ignore this email.</p>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
    }

    res.json({ message: 'If an account exists, a reset link has been sent' });
  } catch (error) {
    next(error);
  }
});

// Reset password with token
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await User.findByResetToken(token);
    if (!user || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(password, 12);
    await User.updatePassword(user.id, hashedPassword);
    await User.clearResetToken(user.id);

    res.json({ message: 'Password reset successful. Please log in.' });
  } catch (error) {
    next(error);
  }
});

// ===== GOOGLE OAUTH =====

// Google OAuth login URL
router.get('/google', (req, res) => {
  const { clientId, redirectUri } = getGoogleConfig();
  
  console.log('Google OAuth Config:', { clientId: clientId ? 'SET' : 'NOT SET', redirectUri });
  
  if (!clientId) {
    console.error('GOOGLE_CLIENT_ID not configured');
    return res.status(500).json({ error: 'Google OAuth not configured. Please set GOOGLE_CLIENT_ID.' });
  }

  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=email profile&` +
    `access_type=offline&` +
    `prompt=consent`;

  console.log('Redirecting to Google OAuth:', url.substring(0, 100) + '...');
  res.redirect(url);
});

// Google OAuth callback
router.get('/google/callback', async (req, res, next) => {
  try {
    const { code, error: oauthError } = req.query;
    const { clientId, clientSecret, redirectUri } = getGoogleConfig();
    
    console.log('Google OAuth Callback - Config:', { 
      clientId: clientId ? 'SET' : 'NOT SET', 
      clientSecret: clientSecret ? 'SET' : 'NOT SET',
      redirectUri 
    });
    
    if (!clientId || !clientSecret) {
      console.error('Google OAuth not properly configured');
      return res.redirect(`${process.env.FRONTEND_URL}/login.html?error=oauth_not_configured`);
    }
    
    if (oauthError) {
      console.error('Google OAuth error from provider:', oauthError);
      return res.redirect(`${process.env.FRONTEND_URL}/login.html?error=oauth_denied`);
    }
    
    if (!code) {
      console.error('Google OAuth: No code received');
      return res.redirect(`${process.env.FRONTEND_URL}/login.html?error=oauth_failed`);
    }

    console.log('Google OAuth: Exchanging code for tokens...');
    
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const { access_token } = tokenResponse.data;
    console.log('Google OAuth: Got access token');

    // Get user info from Google
    const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const { email, name, picture } = userResponse.data;
    console.log('Google OAuth: User info received:', { email, name });

    // Check if user exists
    let user = await User.findByEmail(email);
    console.log('Google OAuth: User lookup result:', user ? 'Found' : 'Not found');
    
    if (!user) {
      console.log('Google OAuth: Creating new user...');
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 12);
      const myReferralCode = generateReferralCode();

      user = await User.createUser({
        email,
        password: hashedPassword,
        name,
        plan: 'starter',
        credits: 10,
        my_referral_code: myReferralCode
      });
      console.log('Google OAuth: New user created:', user.id);
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Redirect to dashboard with token
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?token=${token}&oauth=success`);
  } catch (error) {
    console.error('Google OAuth error:', error.message);
    console.error('Error details:', error.response?.data || error);
    res.redirect(`${process.env.FRONTEND_URL}/login.html?error=oauth_failed`);
  }
});

module.exports = router;