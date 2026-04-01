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
  const keys = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    HOSTCLAW_OPENAI_KEY: !!process.env.HOSTCLAW_OPENAI_KEY,
    HOSTCLAW_DEFAULT_PROVIDER: process.env.HOSTCLAW_DEFAULT_PROVIDER || 'not set',
  };
  // Try a real AI call
  try {
    const { generateAIResponse } = require('./services/ai');
    const result = await generateAIResponse({
      message: 'Say hello in one word',
      provider: undefined,
      providerConfig: null,
      skills: []
    });
    res.json({ keys, aiTest: { success: !result.error, model: result.model, provider: result.model, content: result.content?.substring(0, 200), error: result.error || false } });
  } catch (e) {
    res.json({ keys, aiTest: { success: false, error: e.message, stack: e.stack?.substring(0, 300) } });
  }
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