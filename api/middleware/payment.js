// Middleware to check if user has paid/active subscription
async function checkPayment(req, res, next) {
  try {
    // Skip check for specific routes if needed
    if (req.path === '/history' && req.method === 'GET') {
      return next();
    }

    const User = require('../models/user');
    const user = await User.findById(req.user.userId);
    
    // Check if user has paid or has active subscription
    const hasPaid = user.has_paid === true || 
                    user.plan !== 'starter' || 
                    user.credits > 0;
    
    if (!hasPaid) {
      return res.status(402).json({
        error: 'Payment required',
        message: 'Please complete payment to access this feature',
        payment_url: '/billing.html'
      });
    }
    
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { checkPayment };
