const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'database.sqlite');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('SQLite connection error:', err);
      } else {
        console.log('✅ Connected to SQLite database at', DB_PATH);
      }
    });
  }
  return db;
}

// Promisify query
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    console.log('SQL:', sql.substring(0, 100), 'Params:', params);
    
    if (sql.trim().toLowerCase().startsWith('select')) {
      db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('Query error:', err);
          reject(err);
        } else {
          console.log('Query returned', rows.length, 'rows');
          resolve({ rows });
        }
      });
    } else {
      db.run(sql, params, function(err) {
        if (err) {
          console.error('Query error:', err);
          reject(err);
        } else {
          console.log('Query affected', this.changes, 'rows, lastID:', this.lastID);
          resolve({ rowCount: this.changes, rows: [{ id: this.lastID }] });
        }
      });
    }
  });
}

// Initialize database tables
async function initDb() {
  const db = getDb();
  
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`CREATE TABLE IF NOT EXISTS users (
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
        reset_token_expires DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) console.error('Error creating users table:', err);
      });

      // Agents table
      db.run(`CREATE TABLE IF NOT EXISTS agents (
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
        last_deployed_at DATETIME,
        message_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`, (err) => {
        if (err) console.error('Error creating agents table:', err);
      });

      // Chat messages table
      db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT DEFAULT 'default',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT,
        tokens INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`, (err) => {
        if (err) console.error('Error creating chat_messages table:', err);
      });

      // Invoices table
      db.run(`CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        stripe_invoice_id TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'usd',
        status TEXT DEFAULT 'pending',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`, (err) => {
        if (err) console.error('Error creating invoices table:', err);
        else {
          console.log('✅ Database tables initialized');
          resolve();
        }
      });
    });
  });
}

module.exports = {
  getDb,
  query,
  initDb
};
