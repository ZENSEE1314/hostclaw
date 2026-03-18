// Middleware to check if user has paid/active subscription
async function checkPayment(req, res, next) {
  try {
    // Always allow GET history
    if (req.path === '/history' && req.method === 'GET') {
      return next();
    }

    const User = require('../models/user');
    const user = await User.findById(req.user.userId);

    // Allow if: paid, on a non-starter plan, has credits, OR has their own API key configured
    const hasPaid = user.has_paid === true ||
                    user.has_paid == 1 ||
                    user.plan !== 'starter' ||
                    parseFloat(user.credits) > 0;

    // Also allow if the user has configured their own API provider
    let hasOwnApiKey = false;
    if (user.api_providers) {
      try {
        const providers = typeof user.api_providers === 'string'
          ? JSON.parse(user.api_providers)
          : user.api_providers;
        hasOwnApiKey = Object.keys(providers).length > 0;
      } catch (e) { /* ignore */ }
    }

    if (!hasPaid && !hasOwnApiKey) {
      return res.status(402).json({
        error: 'Payment required',
        message: 'Please add credits or configure your own AI API key in Settings',
        payment_url: '/billing.html',
        setup_url: '/settings.html'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { checkPayment };
