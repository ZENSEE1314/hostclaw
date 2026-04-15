const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const { query } = require('../config/database');

const router = express.Router();

// Default site settings (used when nothing is saved in DB)
const DEFAULTS = {
  site_name: 'ChatsAI',
  site_tagline: 'AI Chatbots for WhatsApp & Telegram',
  site_description: 'Deploy intelligent AI chatbots that auto-reply to enquiries, handle customer service, and close sales 24/7 on WhatsApp, Telegram, and more.',
  hero_title: 'AI That Sells, Supports & Never Sleeps',
  hero_subtitle: 'Deploy smart chatbots to WhatsApp and Telegram in minutes. Auto-reply to customers, answer FAQs, recommend products, and close sales — all powered by AI.',
  hero_cta_text: 'Start Free',
  hero_cta_link: '/signup.html',
  hero_stats: [
    { value: '50', label: 'Free Messages' },
    { value: '24/7', label: 'Always Online' },
    { value: '2 min', label: 'Setup Time' }
  ],
  features: [
    { icon: 'chat', title: 'Auto-Reply Bot', description: 'AI responds to customer messages instantly on WhatsApp and Telegram. Never miss an enquiry again.' },
    { icon: 'cart', title: 'Sales Assistant', description: 'Recommend products, share pricing, handle objections, and guide customers to purchase — automatically.' },
    { icon: 'headset', title: 'Customer Service', description: 'Answer FAQs, share business hours, provide support info — all from your knowledge base.' },
    { icon: 'brain', title: 'Self-Learning', description: 'Bot learns from your conversation style and adapts. Add product info, FAQs, and it gets smarter over time.' },
    { icon: 'calendar', title: 'Booking System', description: 'Customers can book appointments directly through the bot. Auto-manages time slots and conflicts.' },
    { icon: 'broadcast', title: 'Broadcast & Promos', description: 'Send promotions, festival greetings, and updates to your contact list with one click.' }
  ],
  pricing: [
    { name: '1,000 Messages', price: '$49', period: 'one-time', features: ['1,000 bot replies', 'All AI providers', 'WhatsApp + Telegram'] },
    { name: '5,000 Messages', price: '$99', period: 'one-time', featured: true, features: ['5,000 bot replies', 'All AI providers', 'Priority support'] },
    { name: '500K Monthly', price: '$499', period: '/month', features: ['500,000 bot replies', 'All platforms', 'Analytics'] },
    { name: '1M Yearly', price: '$4,999', period: '/year', badge: 'Best Value', features: ['1,000,000 bot replies', 'All platforms', 'Dedicated support'] }
  ],
  how_it_works: [
    { step: '1', title: 'Sign Up Free', description: 'Create your account in seconds. No credit card needed.' },
    { step: '2', title: 'Connect Your Platform', description: 'Link WhatsApp via QR code or Telegram with a bot token.' },
    { step: '3', title: 'Configure Your Bot', description: 'Add your products, FAQs, and business info. Choose a bot personality.' },
    { step: '4', title: 'Go Live', description: 'Your bot starts replying to customers instantly. You can take over any chat anytime.' }
  ],
  testimonials: [],
  footer_text: 'ChatsAI — AI-powered chatbots for business.',
  contact_email: 'support@chatsai.ai',
  social_links: {},
  meta_title: 'ChatsAI — AI Chatbots for WhatsApp & Telegram | Auto-Reply, Sales & Customer Service',
  meta_description: 'Deploy AI chatbots on WhatsApp and Telegram that auto-reply to enquiries, handle customer service, recommend products, and close sales 24/7. Start free with 50 messages.',
  meta_keywords: 'AI chatbot, WhatsApp bot, Telegram bot, auto reply, customer service bot, sales bot, business automation, chatbot platform',
  og_image: '',
  favicon: ''
};

// GET site settings (public — no auth needed)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT value FROM site_settings WHERE key = 'homepage' LIMIT 1`
    );
    if (result.rows[0]) {
      const saved = JSON.parse(result.rows[0].value);
      res.json({ ...DEFAULTS, ...saved });
    } else {
      res.json(DEFAULTS);
    }
  } catch (e) {
    // Table may not exist yet
    res.json(DEFAULTS);
  }
});

// PUT site settings (admin only)
router.put('/', authenticate, async (req, res, next) => {
  try {
    const isAdmin = await User.isAdmin(req.user.userId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const settings = req.body;

    // Upsert
    try {
      await query(
        `INSERT INTO site_settings (key, value, updated_at)
         VALUES ('homepage', $1, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(settings)]
      );
    } catch (e) {
      // If table doesn't exist with ON CONFLICT, try update then insert
      const existing = await query(`SELECT key FROM site_settings WHERE key = 'homepage'`);
      if (existing.rows.length > 0) {
        await query(`UPDATE site_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'homepage'`, [JSON.stringify(settings)]);
      } else {
        await query(`INSERT INTO site_settings (key, value) VALUES ('homepage', $1)`, [JSON.stringify(settings)]);
      }
    }

    res.json({ message: 'Settings saved', settings });
  } catch (error) { next(error); }
});

module.exports = router;
