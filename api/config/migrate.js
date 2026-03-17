const { query } = require('./database');

async function migrate() {
  console.log('🔄 Running database migrations...');
  
  try {
    // Create users table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        plan TEXT DEFAULT 'starter',
        credits REAL DEFAULT 20.00,
        has_paid INTEGER DEFAULT 0,
        api_providers TEXT DEFAULT '{}',
        skills TEXT DEFAULT '[]',
        platforms TEXT DEFAULT '{}',
        default_provider TEXT DEFAULT 'openai',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        gateway_config TEXT,
        reset_token TEXT,
        reset_token_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table ready');
    
    // Create agents table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        model TEXT DEFAULT 'gpt-4o',
        channels TEXT DEFAULT '[]',
        config TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        deployment_url TEXT,
        deployment_id TEXT,
        container_id TEXT,
        last_deployed_at TIMESTAMP,
        message_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Agents table ready');
    
    // Create chat_messages table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT DEFAULT 'default',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT,
        tokens INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Chat messages table ready');
    
    // Create invoices table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        stripe_invoice_id TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'usd',
        status TEXT DEFAULT 'pending',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP
      )
    `);
    console.log('✅ Invoices table ready');
    
    // Add missing columns to existing users table (PostgreSQL syntax)
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_paid INTEGER DEFAULT 0`);
      console.log('✅ Column has_paid ready');
    } catch (e) { console.log('ℹ️ has_paid:', e.message); }
    
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS api_providers TEXT DEFAULT '{}'`);
      console.log('✅ Column api_providers ready');
    } catch (e) { console.log('ℹ️ api_providers:', e.message); }
    
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT DEFAULT '[]'`);
      console.log('✅ Column skills ready');
    } catch (e) { console.log('ℹ️ skills:', e.message); }
    
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS platforms TEXT DEFAULT '{}'`);
      console.log('✅ Column platforms ready');
    } catch (e) { console.log('ℹ️ platforms:', e.message); }
    
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_provider TEXT DEFAULT 'openai'`);
      console.log('✅ Column default_provider ready');
    } catch (e) { console.log('ℹ️ default_provider:', e.message); }
    
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
      console.log('✅ Column reset_token ready');
    } catch (e) { console.log('ℹ️ reset_token:', e.message); }
    
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`);
      console.log('✅ Column reset_token_expires ready');
    } catch (e) { console.log('ℹ️ reset_token_expires:', e.message); }
    
    console.log('✅ All migrations complete!');
    return true;
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = migrate;
