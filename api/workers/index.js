// Simple in-memory queue (for development without Redis)
// For production, replace with Bull + Redis

class SimpleQueue {
  constructor(name) {
    this.name = name;
    this.jobs = [];
    this.processors = new Map();
    console.log(`📬 Queue '${name}' initialized (in-memory mode)`);
  }

  add(jobName, data) {
    console.log(`📨 Job '${jobName}' added to queue '${this.name}'`);
    this.jobs.push({ name: jobName, data, timestamp: Date.now() });
    
    // Process immediately if processor exists
    if (this.processors.has(jobName)) {
      const processor = this.processors.get(jobName);
      setImmediate(() => {
        processor({ data }).catch(err => {
          console.error(`Job ${jobName} failed:`, err);
        });
      });
    }
    
    return Promise.resolve({ id: Date.now() });
  }

  process(jobName, processor) {
    this.processors.set(jobName, processor);
    console.log(`⚙️  Processor '${jobName}' registered`);
  }
}

// Create queues
const emailQueue = new SimpleQueue('emails');
const usageQueue = new SimpleQueue('usage');
const reportsQueue = new SimpleQueue('reports');

// Load email service
const EmailService = require('../services/email');
const User = require('../models/user');
const { query } = require('../config/database');

// Email processor
emailQueue.process('send', async (job) => {
  const { type, userId, data } = job.data;
  
  try {
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
  } catch (error) {
    console.error('Email job failed:', error.message);
  }
});

// Usage processor
usageQueue.process('deduct', async (job) => {
  const { userId, type, quantity } = job.data;
  
  try {
    // Deduct credits
    const newBalance = await User.deductCredits(userId, quantity);
    
    if (newBalance === undefined) {
      console.error('Insufficient credits for user', userId);
      return;
    }

    // Log usage
    await query(
      'INSERT INTO usage_logs (user_id, type, quantity, cost) VALUES ($1, $2, $3, $4)',
      [userId, type, quantity, quantity]
    );

    console.log(`Usage deducted: ${quantity} from user ${userId}, new balance: ${newBalance}`);

    // Check if low on credits
    if (newBalance < 5) {
      await emailQueue.add('send', {
        type: 'low_credits',
        userId,
        data: { credits: newBalance }
      });
    }
  } catch (error) {
    console.error('Usage deduction failed:', error.message);
  }
});

// Weekly reports processor
reportsQueue.process('weekly', async (job) => {
  const { userId } = job.data;
  
  try {
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
  } catch (error) {
    console.error('Weekly report failed:', error.message);
  }
});

// Export queues
module.exports = {
  emailQueue,
  usageQueue,
  reportsQueue
};