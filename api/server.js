const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

// Try to load .env, but don't fail if it doesn't exist
try {
  require('dotenv').config();
  console.log('✅ .env file loaded');
} catch (e) {
  console.log('No .env file found, using environment variables');
}

// Debug: Log environment variables (without secrets)
console.log('🔧 Environment Check:');
console.log('  FRONTEND_URL:', process.env.FRONTEND_URL || 'NOT SET');
console.log('  DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
console.log('  JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET');
console.log('  GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'SET' : 'NOT SET');
console.log('  STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET' : 'NOT SET');

const authRoutes = require('./routes/auth');
const agentRoutes = require('./routes/agents');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const skillsRoutes = require('./routes/skills');
const providersRoutes = require('./routes/providers');
const platformsRoutes = require('./routes/platforms');
const debugRoutes = require('./routes/debug');
const contactsRoutes = require('./routes/contacts');
const siteSettingsRoutes = require('./routes/site-settings');
const creativeRoutes = require('./routes/creative');
const scraperRoutes = require('./routes/scraper');
const salesRoutes = require('./routes/sales');
const scheduleRoutes = require('./routes/schedule');
const { errorHandler } = require('./middleware/error');
const { initDb } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 10000;

// Trust proxy (required for Render)
app.set('trust proxy', 1);

// Run migrations and initialize database
async function startup() {
  try {
    // Run migrations first
    console.log('🔄 Running migrations...');
    const migrate = require('./config/migrate');
    await migrate();
    console.log('✅ Migrations complete');
    
    // Initialize database connection
    await initDb();
    console.log('✅ Database ready');
    
    // Test database connection
    console.log('🧪 Testing database connection...');
    const { query } = require('./config/database');
    const testResult = await query('SELECT COUNT(*) as count FROM users');
    console.log('✅ Database test passed. Users in DB:', testResult.rows[0]?.count || 0);
    
    // Start openclaw daemon (non-fatal — chat still works without it)
    try {
      const openclawService = require('./services/openclaw');
      openclawService.start().then(() => {
        if (openclawService.isReady()) {
          console.log('✅ OpenClaw daemon running');
        }
      }).catch(e => console.warn('⚠️ OpenClaw start error:', e.message));
    } catch (e) {
      console.warn('⚠️ OpenClaw not installed:', e.message);
    }

    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 ChatsAI API server running on port ${PORT}`);
      console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);

      // Start processors (check every 2 minutes)
      setInterval(processFollowUps, 2 * 60 * 1000);
      setInterval(processScheduledTasks, 2 * 60 * 1000);
      setInterval(processAppointmentReminders, 5 * 60 * 1000);
      console.log('📅 Processors started: follow-ups (2min), tasks (2min), reminders (5min)');
    });
  } catch (err) {
    console.error('❌ Startup failed:', err);
    console.error('Error stack:', err.stack);
    process.exit(1);
  }
}

// Security middleware
app.use(helmet());

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://aibotchat.app',
  'https://www.aibotchat.app',
  'https://chatsai.app',
  'https://www.chatsai.app',
  'https://hostclaw-web.onrender.com',
  'https://hostclaw.onrender.com',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:8080'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // In development allow all
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Raw body for Stripe webhook (must be before express.json)
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Logging
app.use(morgan('combined'));

// Health check - THIS MUST RESPOND!
app.get('/health', async (req, res) => {
  try {
    const { query } = require('./config/database');
    const result = await query('SELECT COUNT(*) as count FROM users');
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      users: result.rows[0]?.count || 0
    });
  } catch (err) {
    res.json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }
});

// Debug endpoints — disabled in production
if (process.env.NODE_ENV !== 'production') {

// Debug: test full Telegram message flow
app.get('/debug/telegram-test', async (req, res) => {
  try {
    const User = require('./models/user');
    const Chat = require('./models/chat');
    const { generateAIResponse } = require('./services/ai');
    const userId = 'b7f44e65-5939-47ef-b7c5-f8c913d3a7d8';
    const steps = [];

    // Step 1: Find user
    const user = await User.findById(userId);
    steps.push({ step: 'findUser', ok: !!user, plan: user?.plan_type, msgCount: user?.message_count, msgLimit: user?.message_limit });

    // Step 2: Check canSendMessage
    const canSend = User.canSendMessage(user);
    steps.push({ step: 'canSendMessage', ok: canSend });

    // Step 3: Deduct message
    const deducted = await User.deductMessage(userId);
    steps.push({ step: 'deductMessage', ok: deducted });

    // Step 4: Save chat message
    try {
      const saved = await Chat.saveMessage({ user_id: userId, session_id: 'debug_test', role: 'user', content: 'debug test' });
      steps.push({ step: 'saveMessage', ok: true, id: saved?.id });
    } catch (e) {
      steps.push({ step: 'saveMessage', ok: false, error: e.message });
    }

    // Step 5: Generate AI response
    try {
      const aiRes = await generateAIResponse({ message: 'say hello in 5 words', provider: undefined, providerConfig: null, skills: [] });
      steps.push({ step: 'generateAI', ok: !aiRes.error, model: aiRes.model, reply: aiRes.content?.substring(0, 100), error: aiRes.error });
    } catch (e) {
      steps.push({ step: 'generateAI', ok: false, error: e.message });
    }

    // Step 6: Check platforms config
    const platforms = typeof user.platforms === 'string' ? JSON.parse(user.platforms || '{}') : (user.platforms || {});
    const tg = platforms.telegram;
    steps.push({ step: 'telegramConfig', ok: tg?.status === 'connected', botName: tg?.bot_name, hasToken: !!tg?.bot_token });

    res.json({ steps, allPassed: steps.every(s => s.ok) });
  } catch (e) {
    res.json({ error: e.message, stack: e.stack?.substring(0, 500) });
  }
});

// Debug endpoint - check database
app.get('/debug/db', async (req, res) => {
  try {
    const { query } = require('./config/database');
    
    // Check users table
    const usersResult = await query('SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 10');
    
    // Check if tables exist
    const tablesResult = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    res.json({
      database: 'PostgreSQL',
      tables: tablesResult.rows.map(r => r.table_name),
      userCount: usersResult.rows.length,
      users: usersResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Debug: test AI provider availability
app.get('/debug/ai', async (req, res) => {
  // Show ALL env vars that look like API keys (masked)
  const allKeys = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.includes('API_KEY') || k.includes('_KEY') || k.includes('GROQ') || k.includes('ANTHROPIC') || k.includes('OPENAI')) {
      allKeys[k] = v ? v.substring(0, 8) + '...' : 'empty';
    }
  }

  // Test each provider individually
  const axios = require('axios');
  const results = {};

  // Test Groq
  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.HOSTCLAW_GROQ_KEY;
  if (groqKey) {
    try {
      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 10
      }, { headers: { 'Authorization': `Bearer ${groqKey}` }, timeout: 10000 });
      results.groq = { ok: true, reply: r.data.choices[0].message.content };
    } catch (e) { results.groq = { ok: false, error: e.response?.data?.error?.message || e.message }; }
  } else { results.groq = { ok: false, error: 'no key found' }; }

  // Test Anthropic
  const antKey = process.env.ANTHROPIC_API_KEY || process.env.HOSTCLAW_ANTHROPIC_KEY;
  if (antKey) {
    try {
      const r = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-5-sonnet-20241022', max_tokens: 10, messages: [{ role: 'user', content: 'say hi' }]
      }, { headers: { 'x-api-key': antKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 10000 });
      results.anthropic = { ok: true, reply: r.data.content[0].text };
    } catch (e) { results.anthropic = { ok: false, error: e.response?.data?.error?.message || e.message }; }
  } else { results.anthropic = { ok: false, error: 'no key found' }; }

  // Test OpenAI
  const oaiKey = process.env.OPENAI_API_KEY || process.env.HOSTCLAW_OPENAI_KEY;
  if (oaiKey) {
    try {
      const r = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 10
      }, { headers: { 'Authorization': `Bearer ${oaiKey}` }, timeout: 10000 });
      results.openai = { ok: true, reply: r.data.choices[0].message.content };
    } catch (e) { results.openai = { ok: false, error: e.response?.data?.error?.message || e.message }; }
  } else { results.openai = { ok: false, error: 'no key found' }; }

  res.json({ envKeys: allKeys, providerTests: results });
});

} // end debug endpoints (NODE_ENV !== 'production')

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/platforms', platformsRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/site-settings', siteSettingsRoutes);
app.use('/api/creative', creativeRoutes);
app.use('/api/scraper', scraperRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/webhooks', webhookRoutes);

// Error handling for API routes
app.use('/api', errorHandler);
app.use('/webhooks', errorHandler);

// Serve frontend static files from parent directory
const path = require('path');
const frontendPath = path.join(__dirname, '..');
app.use(express.static(frontendPath, { extensions: ['html'] }));

// SPA fallback — serve index.html for non-API routes
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Follow-up processor — sends scheduled promo messages
async function processFollowUps() {
  try {
    const { query: dbQuery } = require('./config/database');
    const User = require('./models/user');
    const axios = require('axios');

    const result = await dbQuery(
      `SELECT f.*, u.platforms FROM sales_followups f
       JOIN users u ON u.id = f.user_id
       WHERE f.status = 'pending' AND f.send_at <= CURRENT_TIMESTAMP
       LIMIT 20`
    );

    for (const followup of result.rows) {
      try {
        const platforms = typeof followup.platforms === 'string'
          ? JSON.parse(followup.platforms || '{}') : (followup.platforms || {});

        let sent = false;

        if (followup.platform === 'telegram' && platforms.telegram?.bot_token) {
          const token = Buffer.from(platforms.telegram.bot_token, 'base64').toString();
          await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: followup.platform_id,
            text: followup.message
          });
          sent = true;
        }

        // Mark as sent
        await dbQuery(
          `UPDATE sales_followups SET status = $1, sent_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [sent ? 'sent' : 'failed', followup.id]
        );

        // Deduct message if sent
        if (sent) {
          await User.deductMessage(followup.user_id);
        }

        if (sent) console.log(`📤 Follow-up sent to ${followup.platform_id}`);
      } catch (e) {
        console.error('Follow-up send error:', e.message);
        await dbQuery(
          `UPDATE sales_followups SET status = 'failed' WHERE id = $1`, [followup.id]
        );
      }
    }
  } catch (e) {
    console.error('Follow-up processor error:', e.message);
  }
}

// Scheduled broadcast/task processor
async function processScheduledTasks() {
  try {
    const { query: dbQuery } = require('./config/database');
    const User = require('./models/user');
    const axios = require('axios');
    const result = await dbQuery(
      `SELECT t.*, u.platforms, u.contacts FROM scheduled_tasks t
       JOIN users u ON u.id = t.user_id
       WHERE t.status = 'pending' AND t.scheduled_at <= CURRENT_TIMESTAMP LIMIT 10`
    );
    for (const task of result.rows) {
      try {
        const platforms = typeof task.platforms === 'string' ? JSON.parse(task.platforms || '{}') : (task.platforms || {});
        const contacts = typeof task.target_contacts === 'string' ? JSON.parse(task.target_contacts || '[]') : (task.target_contacts || []);
        const allContacts = typeof task.contacts === 'string' ? JSON.parse(task.contacts || '[]') : (task.contacts || []);

        let targets = contacts.length > 0
          ? allContacts.filter(c => contacts.includes(c.id))
          : task.target_group ? allContacts.filter(c => c.group === task.target_group) : allContacts;

        let sent = 0;
        const tg = platforms.telegram;
        if (tg?.bot_token) {
          const token = Buffer.from(tg.bot_token, 'base64').toString();
          for (const c of targets) {
            if (c.platform === 'telegram' && c.platform_id) {
              try {
                if (task.image_url) {
                  await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
                    chat_id: c.platform_id, photo: task.image_url, caption: task.message || ''
                  });
                } else {
                  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: c.platform_id, text: task.message || task.title || 'Reminder'
                  });
                }
                sent++;
                await User.deductMessage(task.user_id);
              } catch (e) { /* skip failed */ }
            }
          }
        }
        await dbQuery(`UPDATE scheduled_tasks SET status='completed', result=$1 WHERE id=$2`,
          [JSON.stringify({ sent, total: targets.length }), task.id]);
        if (sent > 0) console.log(`📤 Scheduled task sent to ${sent} contacts`);
      } catch (e) { await dbQuery(`UPDATE scheduled_tasks SET status='failed' WHERE id=$1`, [task.id]); }
    }
  } catch (e) { console.error('Scheduled tasks error:', e.message); }
}

// Appointment reminder processor — sends reminders 1 hour before
async function processAppointmentReminders() {
  try {
    const { query: dbQuery } = require('./config/database');
    const axios = require('axios');
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    const now = new Date();

    const agents = await dbQuery(`SELECT a.*, u.platforms, u.email, u.name as owner_name FROM agents a JOIN users u ON u.id = a.user_id WHERE a.bookings IS NOT NULL AND a.bookings != '[]'`);

    for (const row of agents.rows) {
      const bookings = typeof row.bookings === 'string' ? JSON.parse(row.bookings) : (row.bookings || []);
      const platforms = typeof row.platforms === 'string' ? JSON.parse(row.platforms || '{}') : (row.platforms || {});

      for (const b of bookings) {
        if (b.status !== 'confirmed' || b.reminded) continue;
        const bookingTime = new Date(`${b.date}T${b.time}`);
        if (bookingTime > now && bookingTime <= oneHourFromNow) {
          // Send reminder to customer via Telegram
          if (b.customer_phone && platforms.telegram?.bot_token) {
            try {
              const token = Buffer.from(platforms.telegram.bot_token, 'base64').toString();
              await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: b.customer_phone,
                text: `Reminder: You have an appointment at ${b.time} on ${b.date}. See you soon!`
              }).catch(() => {});
            } catch (e) { /* non-fatal */ }
          }

          // Send reminder to owner via Telegram
          if (platforms.telegram?.bot_token) {
            try {
              const token = Buffer.from(platforms.telegram.bot_token, 'base64').toString();
              // Get owner's Telegram chat ID from first admin message
              const ownerMsg = `Upcoming appointment: ${b.customer_name} at ${b.time} on ${b.date}`;
              console.log(`📅 Reminder: ${ownerMsg}`);
            } catch (e) { /* non-fatal */ }
          }

          // Send email reminder to owner
          try {
            const EmailService = require('./services/email');
            await EmailService.send({
              to: row.email,
              subject: `Appointment Reminder: ${b.customer_name} at ${b.time}`,
              text: `You have an upcoming appointment:\n\nCustomer: ${b.customer_name}\nDate: ${b.date}\nTime: ${b.time}\nPhone: ${b.customer_phone || 'N/A'}\n\nFrom your ChatsAI bot "${row.name}".`
            }).catch(() => {});
          } catch (e) { /* email service may not be configured */ }

          // Mark as reminded
          b.reminded = true;
        }
      }
      // Save updated bookings
      await dbQuery('UPDATE agents SET bookings = $1 WHERE id = $2', [JSON.stringify(bookings), row.id]);
    }
  } catch (e) { console.error('Reminder processor error:', e.message); }
}

// Start server with migrations
startup();

module.exports = app;