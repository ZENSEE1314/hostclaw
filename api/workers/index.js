const Queue = require('bull');
const EmailService = require('../services/email');
const User = require('../models/user');
const { query } = require('../config/database');

// Email queue for batch sending
const emailQueue = new Queue('emails', process.env.REDIS_URL);

// Usage tracking queue
const usageQueue = new Queue('usage', process.env.REDIS_URL);

// Weekly reports queue
const reportsQueue = new Queue('reports', process.env.REDIS_URL);

// Process email jobs
emailQueue.process('send', async (job) => {
  const { type, userId, data } = job.data;
  const user = await User.findById(userId);
  
  if (!user) return;

  switch (type) {
    case 'welcome':
      await EmailService.sendWelcomeEmail(user);
      break;
    case 'deployment':
      await EmailService.sendDeploymentComplete(user, data);
      break;
    case 'low_credits':
      await EmailService.sendLowCreditsAlert(user, data.credits);
      break;
    case 'receipt':
      await EmailService.sendPaymentReceipt(user, data);
      break;
    case 'error':
      await EmailService.sendAgentErrorAlert(user, data.agent, data.error);
      break;
  }
});

// Process usage tracking
usageQueue.process('deduct', async (job) => {
  const { userId, type, quantity } = job.data;
  
  try {
    // Deduct credits
    const newBalance = await User.deductCredits(userId, quantity);
    
    // Log usage
    await query(
      'INSERT INTO usage_logs (user_id, type, quantity, cost) VALUES ($1, $2, $3, $4)',
      [userId, type, quantity, quantity]
    );

    // Check if low on credits
    if (newBalance < 5) {
      await emailQueue.add('send', {
        type: 'low_credits',
        userId,
        data: { credits: newBalance }
      });
    }

    return { success: true, newBalance };
  } catch (error) {
    console.error('Usage deduction failed:', error);
    throw error;
  }
});

// Process weekly reports
reportsQueue.process('weekly', async (job) => {
  const { userId } = job.data;
  const user = await User.findById(userId);
  
  if (!user) return;

  // Get weekly stats
  const stats = await query(`
    SELECT 
      COUNT(*) as total_messages,
      COALESCE(SUM(cost), 0) as total_cost
    FROM usage_logs
    WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
  `, [userId]);

  // Get revenue (if they have paid users)
  const revenue = await query(`
    SELECT COALESCE(SUM(amount), 0) as revenue
    FROM invoices
    WHERE user_id = $1 AND status = 'paid' AND created_at >= NOW() - INTERVAL '7 days'
  `, [userId]);

  await EmailService.sendWeeklyReport(user, {
    totalMessages: stats.rows[0].total_messages,
    cost: stats.rows[0].total_cost,
    revenue: revenue.rows[0].revenue
  });
});

// Schedule weekly reports (every Monday at 9 AM)
reportsQueue.add('schedule', {}, {
  repeat: {
    cron: '0 9 * * 1'
  }
});

// Worker exports
module.exports = {
  emailQueue,
  usageQueue,
  reportsQueue
};