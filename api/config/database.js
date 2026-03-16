const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        plan VARCHAR(50) DEFAULT 'starter',
        credits DECIMAL(10,2) DEFAULT 20.00,
        has_paid BOOLEAN DEFAULT FALSE,
        api_providers JSONB DEFAULT '{}',
        skills JSONB DEFAULT '[]',
        platforms JSONB DEFAULT '{}',
        default_provider VARCHAR(50) DEFAULT 'openai',
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        gateway_config JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        model VARCHAR(100) DEFAULT 'gpt-4o',
        channels JSONB DEFAULT '[]',
        config JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'pending',
        deployment_url VARCHAR(500),
        deployment_id VARCHAR(255),
        container_id VARCHAR(255),
        last_deployed_at TIMESTAMP,
        message_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        stripe_invoice_id VARCHAR(255),
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'usd',
        status VARCHAR(50) DEFAULT 'pending',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS deployments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'pending',
        logs TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS usage_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        quantity INTEGER NOT NULL,
        cost DECIMAL(10,4) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        session_id VARCHAR(100) DEFAULT 'default',
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        model VARCHAR(100),
        tokens INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(user_id, session_id);
    `);
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDb,
  query: (text, params) => pool.query(text, params)
};