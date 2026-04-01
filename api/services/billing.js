const User = require('../models/user');

class BillingService {
  static async canCreateAgent(userId) {
    const user = await User.findById(userId);
    if (!user) return false;

    // Allow if user has messages remaining (free tier gets 50)
    if (User.canSendMessage(user)) return true;

    // Allow if user has their own API keys configured
    let hasOwnKey = false;
    if (user.api_providers) {
      try {
        const providers = typeof user.api_providers === 'string'
          ? JSON.parse(user.api_providers)
          : user.api_providers;
        hasOwnKey = Object.keys(providers).length > 0;
      } catch (e) { /* ignore */ }
    }

    return hasOwnKey;
  }
}

module.exports = BillingService;
