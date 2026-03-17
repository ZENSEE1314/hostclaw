const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.SQLITE_PATH ? path.dirname(process.env.SQLITE_PATH) : path.join(__dirname, '../data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'database.sqlite');

console.log('🔧 Database Configuration:');
console.log('  DATA_DIR:', DATA_DIR);
console.log('  DB_PATH:', DB_PATH);
console.log('  Directory exists:', fs.existsSync(DATA_DIR));

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('✅ Created data directory:', DATA_DIR);
  }
} catch (err) {
  console.error('❌ Failed to create data directory:', err);
}

let db;

function getDb() {
  if (!db) {
    console.log('🔄 Creating new database connection to:', DB_PATH);
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('❌ SQLite connection error:', err);
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
    
    const sqlLower = sql.trim().toLowerCase();
    const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
    const table = tableMatch ? tableMatch[1].toLowerCase() : 'unknown';
    
    console.log('📝 SQL:', sql.substring(0, 80), '| Table:', table);
    
    // For SELECT queries
    if (sqlLower.startsWith('select')) {
      db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('❌ SELECT error:', err.message);
          reject(err);
        } else {
          console.log('✅ SELECT returned', rows.length, 'rows');
          resolve({ rows });
        }
      });
    } 
    // For INSERT queries
    else if (sqlLower.startsWith('insert')) {
      console.log('📥 INSERT params:', params.slice(0, 2));
      
      db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ INSERT error:', err.message);
          reject(err);
        } else {
          console.log('✅ INSERT success - lastID:', this.lastID, 'changes:', this.changes);
          
          // For users table, fetch the inserted row
          if (table === 'users' && this.lastID) {
            console.log('🔍 Fetching user by rowid:', this.lastID);
            db.get('SELECT * FROM users WHERE rowid = ?', [this.lastID], (err, row) => {
              if (err) {
                console.error('❌ Fetch error:', err.message);
                resolve({ rowCount: this.changes, rows: [{ id: this.lastID }] });
              } else if (row) {
                console.log('✅ Fetched user:', row.id, row.email);
                resolve({ rowCount: this.changes, rows: [row] });
              } else {
                console.error('❌ User not found after insert!');
                resolve({ rowCount: this.changes, rows: [{ id: this.lastID }] });
              }
            });
          } else {
            resolve({ rowCount: this.changes, rows: [{ id: this.lastID }] });
          }
        }
      });
    }
    // For UPDATE queries
    else if (sqlLower.startsWith('update')) {
      db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ UPDATE error:', err.message);
          reject(err);
        } else {
          console.log('✅ UPDATE affected', this.changes, 'rows');
          resolve({ rowCount: this.changes, rows: [] });
        }
      });
    }
    // For DELETE queries
    else if (sqlLower.startsWith('delete')) {
      db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ DELETE error:', err.message);
          reject(err);
        } else {
          console.log('✅ DELETE affected', this.changes, 'rows');
          resolve({ rowCount: this.changes, rows: [] });
        }
      });
    }
    // Other queries
    else {
      db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ Query error:', err.message);
          reject(err);
        } else {
          console.log('✅ Query affected', this.changes, 'rows');
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
        if (err) console.error('❌ Error creating users table:', err);
        else console.log('✅ Users table ready');
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
        if (err) console.error('❌ Error creating agents table:', err);
        else console.log('✅ Agents table ready');
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
        if (err) console.error('❌ Error creating chat_messages table:', err);
        else console.log('✅ Chat messages table ready');
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
        if (err) console.error('❌ Error creating invoices table:', err);
        else {
          console.log('✅ Invoices table ready');
          console.log('✅ Database initialization complete');
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
