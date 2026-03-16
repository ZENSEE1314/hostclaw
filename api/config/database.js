const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let pool;
let db;
let useSQLite = false;

// Try PostgreSQL first, fallback to SQLite
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('✅ Using PostgreSQL');
  } catch (err) {
    console.log('⚠️ PostgreSQL connection failed, falling back to SQLite');
    useSQLite = true;
  }
} else {
  console.log('⚠️ DATABASE_URL not set, using SQLite');
  useSQLite = true;
}

// Initialize SQLite if needed
if (useSQLite) {
  const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../data/database.sqlite');
  
  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('SQLite connection error:', err);
    } else {
      console.log('✅ Connected to SQLite:', DB_PATH);
    }
  });
}

// Query function that works with both PostgreSQL and SQLite
async function query(sql, params = []) {
  if (useSQLite) {
    return sqliteQuery(sql, params);
  } else {
    return postgresQuery(sql, params);
  }
}

async function postgresQuery(sql, params) {
  const result = await pool.query(sql, params);
  return result;
}

function sqliteQuery(sql, params) {
  return new Promise((resolve, reject) => {
    // Convert PostgreSQL syntax to SQLite
    let sqliteSql = sql
      .replace(/UUID/g, 'TEXT')
      .replace(/JSONB/g, 'TEXT')
      .replace(/DECIMAL\(\d+,\d+\)/g, 'REAL')
      .replace(/BOOLEAN/g, 'INTEGER')
      .replace(/TIMESTAMP/g, 'DATETIME')
      .replace(/gen_random_uuid\(\)/g, "lower(hex(randomblob(16)))")
      .replace(/DEFAULT CURRENT_TIMESTAMP/g, "DEFAULT (datetime('now'))")
      .replace(/ON DELETE CASCADE/g, '')
      .replace(/CREATE INDEX IF NOT EXISTS.*?ON.*?\(.*?\);?/gi, ''); // Skip index creation for now

    // Handle parameterized queries ($1, $2 -> ?, ?)
    let paramIndex = 0;
    sqliteSql = sqliteSql.replace(/\$(\d+)/g, (match, num) => {
      return '?';
    });

    const isSelect = sqliteSql.trim().toLowerCase().startsWith('select');

    if (isSelect) {
      db.all(sqliteSql, params, (err, rows) => {
        if (err) {
          console.error('SQLite query error:', err);
          reject(err);
        } else {
          // Parse JSON columns
          rows.forEach(row => {
            ['api_providers', 'skills', 'platforms', 'gateway_config', 'config', 'channels'].forEach(col => {
              if (row[col] && typeof row[col] === 'string') {
                try {
                  row[col] = JSON.parse(row[col]);
                } catch (e) {}
              }
            });
          });
          resolve({ rows });
        }
      });
    } else {
      db.run(sqliteSql, params, function(err) {
        if (err) {
          console.error('SQLite query error:', err);
          reject(err);
        } else {
          resolve({ 
            rowCount: this.changes,
            rows: [{ id: this.lastID }]
          });
        }
      });
    }
  });
}

// Initialize database tables
async function initDb() {
  if (useSQLite) {
    return initSQLite();
  } else {
    return initPostgres();
  }
}

async function initPostgres() {
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
    console.log('✅ PostgreSQL database initialized');
  } finally {
    client.release();
  }
}

async function initSQLite() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
        last_deployed_at DATETIME,
        message_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL,
        stripe_invoice_id TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'usd',
        status TEXT DEFAULT 'pending',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_id TEXT,
        status TEXT DEFAULT 'pending',
        logs TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        error_message TEXT
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT,
        agent_id TEXT,
        type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        cost REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT,
        session_id TEXT DEFAULT 'default',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT,
        tokens INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) reject(err);
        else {
          console.log('✅ SQLite database initialized');
          resolve();
        }
      });
    });
  });
}

module.exports = {
  pool,
  db,
  useSQLite,
  initDb,
  query: (text, params) => query(text, params)
};
