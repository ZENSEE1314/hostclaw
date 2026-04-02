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
      console.log(`🚀 HostClaw API server running on port ${PORT}`);
      console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
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
app.use('/webhooks', webhookRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server with migrations
startup();

module.exports = app;