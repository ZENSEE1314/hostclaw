const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool;
let usePostgres = false;
let useJSON = false;

// Try PostgreSQL first
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    usePostgres = true;
    console.log('✅ Using PostgreSQL');
  } catch (err) {
    console.log('⚠️ PostgreSQL connection failed:', err.message);
    useJSON = true;
  }
} else {
  console.log('⚠️ DATABASE_URL not set, using JSON file database');
  useJSON = true;
}

// JSON Database setup
const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (useJSON) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let jsonDb = { users: [], agents: [], chat_messages: [], invoices: [], usage_logs: [] };

function loadJsonDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      jsonDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.log('Creating new JSON database');
    }
  }
}

function saveJsonDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(jsonDb, null, 2));
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Auto-save
process.on('exit', () => { if (useJSON) saveJsonDb(); });
process.on('SIGINT', () => { if (useJSON) saveJsonDb(); process.exit(); });

loadJsonDb();

// Parse WHERE conditions
function parseWhere(sql, params) {
  const conditions = {};
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/i);
  
  if (whereMatch) {
    let clause = whereMatch[1];
    // Replace $1, $2 with actual params
    params.forEach((param, i) => {
      clause = clause.replace(`$${i + 1}`, JSON.stringify(param));
    });
    
    // Parse simple equality conditions
    const parts = clause.split(/\s+AND\s+/i);
    parts.forEach(part => {
      const match = part.match(/(\w+)\s*=\s*(.+)/);
      if (match) {
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        try { val = JSON.parse(val); } catch(e) {}
        conditions[match[1]] = val;
      }
    });
  }
  
  return conditions;
}

function matches(row, conditions) {
  for (const [key, val] of Object.entries(conditions)) {
    if (row[key] !== val) return false;
  }
  return true;
}

// Query function
async function query(sql, params = []) {
  if (usePostgres) {
    return await pool.query(sql, params);
  }
  
  // JSON Database query
  const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
  const table = tableMatch ? tableMatch[1].toLowerCase() : '';
  
  // SELECT
  if (sql.toLowerCase().startsWith('select')) {
    let results = [...(jsonDb[table] || [])];
    const conditions = parseWhere(sql, params);
    results = results.filter(row => matches(row, conditions));
    
    // Handle ORDER BY
    const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(DESC|ASC))?/i);
    if (orderMatch) {
      const col = orderMatch[1];
      const desc = orderMatch[2] === 'DESC';
      results.sort((a, b) => {
        const aVal = a[col] || '';
        const bVal = b[col] || '';
        return desc ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1);
      });
    }
    
    // Handle LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      results = results.slice(0, parseInt(limitMatch[1]));
    }
    
    // Parse JSON columns
    results.forEach(row => {
      ['api_providers', 'skills', 'platforms', 'config', 'channels', 'gateway_config'].forEach(col => {
        if (row[col] && typeof row[col] === 'string') {
          try { row[col] = JSON.parse(row[col]); } catch(e) {}
        }
      });
    });
    
    return { rows: results };
  }
  
  // INSERT
  if (sql.toLowerCase().startsWith('insert')) {
    const newRow = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    
    const colMatch = sql.match(/INSERT INTO \w+ \(([^)]+)\) VALUES \(([^)]+)\)/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map(c => c.trim());
      const vals = colMatch[2].split(',').map((v, i) => params[i]);
      
      cols.forEach((col, i) => {
        let val = vals[i];
        // Stringify JSON columns
        if (['api_providers', 'skills', 'platforms', 'config', 'channels', 'gateway_config'].includes(col) && typeof val === 'object') {
          val = JSON.stringify(val);
        }
        newRow[col] = val;
      });
    }
    
    if (!jsonDb[table]) jsonDb[table] = [];
    jsonDb[table].push(newRow);
    saveJsonDb();
    
    return { rows: [newRow], rowCount: 1 };
  }
  
  // UPDATE
  if (sql.toLowerCase().startsWith('update')) {
    const conditions = parseWhere(sql, params.slice(1));
    let updated = 0;
    
    (jsonDb[table] || []).forEach(row => {
      if (matches(row, conditions)) {
        // Parse SET clause
        const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
        if (setMatch) {
          const sets = setMatch[1].split(',');
          sets.forEach(set => {
            const m = set.match(/(\w+)\s*=\s*\$(\d+)/);
            if (m) {
              let val = params[parseInt(m[2]) - 1];
              if (['api_providers', 'skills', 'platforms', 'config', 'channels', 'gateway_config'].includes(m[1]) && typeof val === 'object') {
                val = JSON.stringify(val);
              }
              row[m[1]] = val;
            }
          });
          row.updated_at = new Date().toISOString();
          updated++;
        }
      }
    });
    
    if (updated > 0) saveJsonDb();
    return { rowCount: updated };
  }
  
  // DELETE
  if (sql.toLowerCase().startsWith('delete')) {
    const conditions = parseWhere(sql, params);
    const beforeLen = (jsonDb[table] || []).length;
    jsonDb[table] = (jsonDb[table] || []).filter(row => !matches(row, conditions));
    const deleted = beforeLen - jsonDb[table].length;
    
    if (deleted > 0) saveJsonDb();
    return { rowCount: deleted };
  }
  
  return { rows: [] };
}

// Initialize database
async function initDb() {
  if (usePostgres) {
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

        CREATE TABLE IF NOT EXISTS invoices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          amount DECIMAL(10,2) NOT NULL,
          currency VARCHAR(10) DEFAULT 'usd',
          status VARCHAR(50) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('✅ PostgreSQL database initialized');
    } finally {
      client.release();
    }
  } else {
    // JSON database - ensure arrays exist
    if (!jsonDb.users) jsonDb.users = [];
    if (!jsonDb.agents) jsonDb.agents = [];
    if (!jsonDb.chat_messages) jsonDb.chat_messages = [];
    if (!jsonDb.invoices) jsonDb.invoices = [];
    if (!jsonDb.usage_logs) jsonDb.usage_logs = [];
    saveJsonDb();
    console.log('✅ JSON database initialized at:', DB_FILE);
  }
}

module.exports = {
  pool,
  initDb,
  query: (text, params) => query(text, params)
};
