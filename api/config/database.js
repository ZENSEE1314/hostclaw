const { Pool } = require('pg');

// Use PostgreSQL if DATABASE_URL is set, otherwise fall back to SQLite
let query;
let initDb;

if (process.env.DATABASE_URL) {
  console.log('🐘 Using PostgreSQL database');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for Render PostgreSQL
    }
  });

  query = async (sql, params = []) => {
    // Replace $1, $2 style params with PostgreSQL style if needed
    // The SQL should already use $1, $2 style
    console.log('📝 PostgreSQL Query:', sql.substring(0, 80));
    console.log('   Params:', params.slice(0, 2));
    
    try {
      const result = await pool.query(sql, params);
      console.log('✅ Query returned', result.rows.length, 'rows, command:', result.command);
      return { rows: result.rows, rowCount: result.rowCount };
    } catch (err) {
      console.error('❌ PostgreSQL Error:', err.message);
      throw err;
    }
  };

  initDb = async () => {
    console.log('🐘 PostgreSQL database ready');
    // Tables are managed by migrations or created automatically
  };

} else {
  console.log('📦 Using SQLite database (DATABASE_URL not set)');
  const sqlite = require('./database-sqlite');
  query = sqlite.query;
  initDb = sqlite.initDb;
}

module.exports = { query, initDb };
