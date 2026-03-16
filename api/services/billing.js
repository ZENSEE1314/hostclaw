const User = require('../models/user');

const PLAN_LIMITS = {
  starter: { maxAgents: 1, maxChannels: 2, storageGB: 1 },
  pro: { maxAgents: 5, maxChannels: Infinity, storageGB: 10 },
  enterprise: { maxAgents: Infinity, maxChannels: Infinity, storageGB: 100 }
};

class BillingService {
  static async canCreateAgent(userId) {
    const user = await User.findById(userId);
    if (!user) return false;

    const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.starter;
    const currentAgentCount = await User.getAgentCount(userId);

    return currentAgentCount < limits.maxAgents;
  }

  static async getPlanLimits(plan) {
    return PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  }

  static async calculateUsageCost(type, quantity) {
    const rates = {
      'gpt-4o': { input: 0.005, output: 0.015 }, // per 1K tokens
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'gemini-pro': { input: 0.0005, output: 0.0015 },
      'message': 0.001, // per message
      'storage': 0.10 // per GB/month
    };

    return rates[type] || 0;
  }

  static async chargeForUsage(userId, type, quantity) {
    const cost = await this.calculateUsageCost(type, quantity);
    const credits = await User.deductCredits(userId, cost);
    
    if (credits === undefined) {
      throw new Error('Insufficient credits');
    }

    return { cost, remainingCredits: credits };
  }
}

module.exports = BillingService;