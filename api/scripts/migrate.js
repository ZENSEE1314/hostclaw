const { query } = require('./config/database');

async function migrate() {
  console.log('🔄 Running database migrations...');
  
  try {
    // Check if has_paid column exists
    const checkResult = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'has_paid'
    `);
    
    if (checkResult.rows.length === 0) {
      console.log('➕ Adding has_paid column to users table...');
      await query(`ALTER TABLE users ADD COLUMN has_paid INTEGER DEFAULT 0`);
      console.log('✅ has_paid column added');
    } else {
      console.log('✅ has_paid column already exists');
    }
    
    // Check if api_providers column exists
    const apiProvidersCheck = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'api_providers'
    `);
    
    if (apiProvidersCheck.rows.length === 0) {
      console.log('➕ Adding api_providers column to users table...');
      await query(`ALTER TABLE users ADD COLUMN api_providers TEXT DEFAULT '{}'`);
      console.log('✅ api_providers column added');
    }
    
    // Check if skills column exists
    const skillsCheck = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'skills'
    `);
    
    if (skillsCheck.rows.length === 0) {
      console.log('➕ Adding skills column to users table...');
      await query(`ALTER TABLE users ADD COLUMN skills TEXT DEFAULT '[]'`);
      console.log('✅ skills column added');
    }
    
    // Check if platforms column exists
    const platformsCheck = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'platforms'
    `);
    
    if (platformsCheck.rows.length === 0) {
      console.log('➕ Adding platforms column to users table...');
      await query(`ALTER TABLE users ADD COLUMN platforms TEXT DEFAULT '{}'`);
      console.log('✅ platforms column added');
    }
    
    // Check if default_provider column exists
    const defaultProviderCheck = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'default_provider'
    `);
    
    if (defaultProviderCheck.rows.length === 0) {
      console.log('➕ Adding default_provider column to users table...');
      await query(`ALTER TABLE users ADD COLUMN default_provider TEXT DEFAULT 'openai'`);
      console.log('✅ default_provider column added');
    }
    
    // Check if reset_token column exists
    const resetTokenCheck = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'reset_token'
    `);
    
    if (resetTokenCheck.rows.length === 0) {
      console.log('➕ Adding reset_token column to users table...');
      await query(`ALTER TABLE users ADD COLUMN reset_token TEXT`);
      console.log('✅ reset_token column added');
    }
    
    // Check if reset_token_expires column exists
    const resetTokenExpiresCheck = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'reset_token_expires'
    `);
    
    if (resetTokenExpiresCheck.rows.length === 0) {
      console.log('➕ Adding reset_token_expires column to users table...');
      await query(`ALTER TABLE users ADD COLUMN reset_token_expires TIMESTAMP`);
      console.log('✅ reset_token_expires column added');
    }
    
    console.log('✅ All migrations complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
