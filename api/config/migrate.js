const { initDb } = require('./config/database');

async function migrate() {
  try {
    console.log('🔄 Running database migrations...');
    await initDb();
    console.log('✅ Migrations complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();