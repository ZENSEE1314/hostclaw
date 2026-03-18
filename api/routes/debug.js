const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

const router = express.Router();

// Debug endpoint - check user configuration
router.get('/user-config', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      credits: user.credits,
      has_paid: user.has_paid,
      default_provider: user.default_provider,
      providers: user.api_providers ? Object.keys(
        typeof user.api_providers === 'string' 
          ? JSON.parse(user.api_providers) 
          : user.api_providers
      ) : [],
      can_chat: user.has_paid || user.credits > 0,
      message: user.has_paid ? 'Paid user' : (user.credits > 0 ? 'Has credits' : 'Need payment')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
