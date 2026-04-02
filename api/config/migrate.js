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
        referral_code TEXT,
        applied_coupon TEXT,
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

    // Add coupon and referral columns
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`);
      console.log('✅ Column referral_code ready');
    } catch (e) { console.log('ℹ️ referral_code:', e.message); }
    
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS applied_coupon TEXT`);
      console.log('✅ Column applied_coupon ready');
    } catch (e) { console.log('ℹ️ applied_coupon:', e.message); }

    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS my_referral_code TEXT UNIQUE`);
      console.log('✅ Column my_referral_code ready');
    } catch (e) { console.log('ℹ️ my_referral_code:', e.message); }

    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT`);
      console.log('✅ Column referred_by ready');
    } catch (e) { console.log('ℹ️ referred_by:', e.message); }

    // Message-based billing columns
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0`);
      console.log('✅ Column message_count ready');
    } catch (e) { console.log('ℹ️ message_count:', e.message); }

    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS message_limit INTEGER DEFAULT 50`);
      console.log('✅ Column message_limit ready');
    } catch (e) { console.log('ℹ️ message_limit:', e.message); }

    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free'`);
      console.log('✅ Column plan_type ready');
    } catch (e) { console.log('ℹ️ plan_type:', e.message); }

    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP`);
      console.log('✅ Column plan_expires_at ready');
    } catch (e) { console.log('ℹ️ plan_expires_at:', e.message); }

    // Agent configuration columns
    try {
      await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT`);
      console.log('✅ Column agents.system_prompt ready');
    } catch (e) { console.log('ℹ️ agents.system_prompt:', e.message); }

    try {
      await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS bot_type TEXT DEFAULT 'personal'`);
      console.log('✅ Column agents.bot_type ready');
    } catch (e) { console.log('ℹ️ agents.bot_type:', e.message); }

    try {
      await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge_base TEXT DEFAULT '[]'`);
      console.log('✅ Column agents.knowledge_base ready');
    } catch (e) { console.log('ℹ️ agents.knowledge_base:', e.message); }

    try {
      await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS business_name TEXT`);
      console.log('✅ Column agents.business_name ready');
    } catch (e) { console.log('ℹ️ agents.business_name:', e.message); }

    try {
      await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS bookings TEXT DEFAULT '[]'`);
      console.log('✅ Column agents.bookings ready');
    } catch (e) { console.log('ℹ️ agents.bookings:', e.message); }

    try {
      await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS linked_platforms TEXT DEFAULT '[]'`);
      console.log('✅ Column agents.linked_platforms ready');
    } catch (e) { console.log('ℹ️ agents.linked_platforms:', e.message); }

    // Site settings table for admin-editable homepage content
    await query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Site settings table ready');

    // Sales leads (CRM)
    await query(`
      CREATE TABLE IF NOT EXISTS sales_leads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_name TEXT DEFAULT 'Unknown',
        customer_phone TEXT,
        customer_email TEXT,
        platform TEXT,
        platform_id TEXT,
        session_id TEXT,
        product_interest TEXT,
        amount REAL DEFAULT 0,
        status TEXT DEFAULT 'enquiry',
        notes TEXT,
        tags TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Sales leads table ready');

    // Sales follow-up queue
    await query(`
      CREATE TABLE IF NOT EXISTS sales_followups (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        lead_id TEXT,
        session_id TEXT,
        platform TEXT,
        platform_id TEXT,
        message TEXT NOT NULL,
        send_at TIMESTAMP NOT NULL,
        sequence_index INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Sales followups table ready');

    // Contacts column for broadcast messaging
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS contacts TEXT DEFAULT '[]'`);
      console.log('✅ Column users.contacts ready');
    } catch (e) { console.log('ℹ️ users.contacts:', e.message); }

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
