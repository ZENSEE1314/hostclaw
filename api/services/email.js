const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    // Only create transporter if SMTP is configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: (process.env.SMTP_PORT || '587') === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      console.log('⚠️ SMTP not configured, emails will be logged but not sent');
      this.transporter = null;
    }
  }

  async send({ to, subject, html }) {
    if (!this.transporter) {
      console.log(`📧 [Email would be sent] To: ${to}, Subject: ${subject}`);
      return { messageId: 'mock-' + Date.now() };
    }
    
    try {
      const info = await this.transporter.sendMail({
        from: `"HostClaw" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html
      });
      console.log('📧 Email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('❌ Email failed:', error.message);
      // Don't throw - just log error
      return { error: error.message };
    }
  }

  async sendWelcomeEmail(user) {
    return this.send({
      to: user.email,
      subject: '🐾 Welcome to HostClaw.ai!',
      html: this.getWelcomeTemplate(user)
    });
  }

  async sendDeploymentComplete(user, agent) {
    return this.send({
      to: user.email,
      subject: `🚀 ${agent.name} is now live!`,
      html: this.getDeploymentTemplate(user, agent)
    });
  }

  async sendLowCreditsAlert(user, credits) {
    return this.send({
      to: user.email,
      subject: '⚠️ Low Credits Alert',
      html: this.getLowCreditsTemplate(user, credits)
    });
  }

  async sendPaymentReceipt(user, invoice) {
    return this.send({
      to: user.email,
      subject: `💳 Payment Receipt - $${invoice.amount}`,
      html: this.getReceiptTemplate(user, invoice)
    });
  }

  async sendAgentErrorAlert(user, agent, error) {
    return this.send({
      to: user.email,
      subject: `❌ ${agent.name} encountered an error`,
      html: this.getErrorTemplate(user, agent, error)
    });
  }

  async sendWeeklyReport(user, stats) {
    return this.send({
      to: user.email,
      subject: '📊 Your HostClaw Weekly Report',
      html: this.getWeeklyReportTemplate(user, stats)
    });
  }

  // NOTE: duplicate send() removed — the first definition (with null transporter check) is used

  getWelcomeTemplate(user) {
    return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #f8fafc; background: #0a0a1a; padding: 40px; border-radius: 20px;">
      <h1 style="background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
        🐾 Welcome to HostClaw!
      </h1>
      <p>Hi ${user.name},</p>
      <p>Your OpenClaw cloud hosting platform is ready! Here's what you can do:</p>
      <ul>
        <li>🤖 Deploy your first AI agent</li>
        <li>💳 Set up payment collection</li>
        <li>📊 Monitor performance in real-time</li>
      </ul>
      <p>You've received <strong>50 free messages</strong> to get started!</p>
      <a href="${process.env.FRONTEND_URL}/dashboard" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); color: white; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 20px;">
        Go to Dashboard →
      </a>
    </div>`;
  }

  getDeploymentTemplate(user, agent) {
    return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #f8fafc; background: #0a0a1a; padding: 40px; border-radius: 20px;">
      <h1 style="color: #10b981;">🚀 Deployment Successful!</h1>
      <p>Hi ${user.name},</p>
      <p><strong>${agent.name}</strong> is now live and ready to serve!</p>
      <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; margin: 20px 0;">
        <p style="margin: 0;"><strong>URL:</strong> <a href="${agent.deployment_url}" style="color: #818cf8;">${agent.deployment_url}</a></p>
        <p style="margin: 10px 0 0 0;"><strong>Status:</strong> <span style="color: #10b981;">● Running</span></p>
      </div>
      <a href="${process.env.FRONTEND_URL}/dashboard" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); color: white; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600;">
        View Dashboard →
      </a>
    </div>`;
  }

  getLowCreditsTemplate(user, credits) {
    return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #f8fafc; background: #0a0a1a; padding: 40px; border-radius: 20px;">
      <h1 style="color: #f59e0b;">⚠️ Low Credits Alert</h1>
      <p>Hi ${user.name},</p>
      <p>Your account balance is running low:</p>
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center;">
        <p style="font-size: 2rem; font-weight: 700; margin: 0; color: #f59e0b;">$${credits.toFixed(2)}</p>
        <p style="margin: 5px 0 0 0; color: #94a3b8;">remaining credits</p>
      </div>
      <p>Add more credits to keep your agents running smoothly.</p>
      <a href="${process.env.FRONTEND_URL}/dashboard/billing" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); color: white; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 20px;">
        Add Credits →
      </a>
    </div>`;
  }

  getReceiptTemplate(user, invoice) {
    return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #f8fafc; background: #0a0a1a; padding: 40px; border-radius: 20px;">
      <h1 style="color: #10b981;">💳 Payment Received</h1>
      <p>Hi ${user.name},</p>
      <p>Thank you for your payment. Here's your receipt:</p>
      <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Amount:</strong> $${invoice.amount}</p>
        <p style="margin: 10px 0 0 0;"><strong>Description:</strong> ${invoice.description}</p>
        <p style="margin: 10px 0 0 0;"><strong>Date:</strong> ${new Date(invoice.created_at).toLocaleDateString()}</p>
        <p style="margin: 10px 0 0 0;"><strong>Invoice ID:</strong> ${invoice.id}</p>
      </div>
    </div>`;
  }

  getErrorTemplate(user, agent, error) {
    return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #f8fafc; background: #0a0a1a; padding: 40px; border-radius: 20px;">
      <h1 style="color: #ef4444;">❌ Agent Error</h1>
      <p>Hi ${user.name},</p>
      <p>Your agent <strong>${agent.name}</strong> encountered an error:</p>
      <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; padding: 20px; border-radius: 12px; margin: 20px 0;">
        <code style="color: #ef4444;">${error.message || error}</code>
      </div>
      <a href="${process.env.FRONTEND_URL}/dashboard/agents/${agent.id}/logs" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); color: white; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600;">
        View Logs →
      </a>
    </div>`;
  }

  getWeeklyReportTemplate(user, stats) {
    return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #f8fafc; background: #0a0a1a; padding: 40px; border-radius: 20px;">
      <h1 style="background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
        📊 Weekly Report
      </h1>
      <p>Hi ${user.name},</p>
      <p>Here's how your agents performed this week:</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
        <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; text-align: center;">
          <p style="font-size: 2rem; font-weight: 700; margin: 0; color: #6366f1;">${stats.totalMessages}</p>
          <p style="margin: 5px 0 0 0; color: #94a3b8; font-size: 0.875rem;">Total Messages</p>
        </div>
        <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; text-align: center;">
          <p style="font-size: 2rem; font-weight: 700; margin: 0; color: #10b981;">$${stats.revenue}</p>
          <p style="margin: 5px 0 0 0; color: #94a3b8; font-size: 0.875rem;">Revenue</p>
        </div>
      </div>
      <a href="${process.env.FRONTEND_URL}/dashboard/analytics" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); color: white; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600;">
        View Full Analytics →
      </a>
    </div>`;
  }
}

module.exports = new EmailService();