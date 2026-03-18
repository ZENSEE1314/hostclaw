const User = require('../models/user');

// Single pricing plan
const PLAN_CONFIG = {
  name: 'professional',
  setupFee: 500,      // $500 USD setup fee
  monthlyTokens: 500, // 500 tokens included per month
  maxAgents: Infinity,
  maxChannels: Infinity,
  storageGB: 10
};

// Top up pricing
const TOP_UP_PRICING = {
  amount: 20,    // $20 USD
  tokens: 1000   // 1000 tokens
};

class BillingService {
  static async getPlanConfig() {
    return PLAN_CONFIG;
  }

  static async getTopUpPricing() {
    return TOP_UP_PRICING;
  }

  static async canCreateAgent(userId) {
    // Allow agent creation for any paid user (regardless of plan)
    const user = await User.findById(userId);
    return user && (user.has_paid === 1 || user.has_paid === true);
  }

  static async calculateUsageCost(type, quantity) {
    // Token costs per operation
    const rates = {
      'gpt-4o': { input: 0.005, output: 0.015 }, // per 1K tokens
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'gemini-pro': { input: 0.0005, output: 0.0015 },
      'message': 0.001, // per message
      'storage': 0.10   // per GB/month
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

  static async processTopUp(userId, paymentAmount) {
    // Calculate tokens based on $20 = 1000 tokens ratio
    const tokensPerDollar = TOP_UP_PRICING.tokens / TOP_UP_PRICING.amount;
    const tokensToAdd = Math.floor(paymentAmount * tokensPerDollar);
    
    // Add credits to user account
    const newBalance = await User.updateCredits(userId, tokensToAdd);
    
    return {
      amountPaid: paymentAmount,
      tokensAdded: tokensToAdd,
      newBalance: newBalance
    };
  }
}

module.exports = BillingService;