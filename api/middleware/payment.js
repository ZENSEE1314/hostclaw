// Middleware to check if user has messages remaining or own API keys
async function checkPayment(req, res, next) {
  try {
    // Always allow GET history
    if (req.path === '/history' && req.method === 'GET') {
      return next();
    }

    const User = require('../models/user');
    const user = await User.findById(req.user.userId);

    // Check message-based billing
    const hasMessages = User.canSendMessage(user);

    // Also allow if user has their own API provider configured
    let hasOwnApiKey = false;
    if (user.api_providers) {
      try {
        const providers = typeof user.api_providers === 'string'
          ? JSON.parse(user.api_providers)
          : user.api_providers;
        hasOwnApiKey = Object.keys(providers).length > 0;
      } catch (e) { /* ignore */ }
    }

    if (!hasMessages && !hasOwnApiKey) {
      return res.status(402).json({
        error: 'Message limit reached',
        message: 'You have used all your free messages. Upgrade to continue.',
        payment_url: '/billing.html',
        setup_url: '/providers.html'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { checkPayment };
