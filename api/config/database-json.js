const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load or initialize database
let db = { users: [], agents: [], chat_messages: [], invoices: [], usage_logs: [] };
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.log('Creating new database file');
  }
}

// Auto-save on exit
process.on('exit', () => saveDb());
process.on('SIGINT', () => { saveDb(); process.exit(); });

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Generate UUID
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Query function mimicking pg
async function query(sql, params = []) {
  const table = getTableName(sql);
  
  if (sql.toLowerCase().includes('select')) {
    // Handle SELECT
    let results = [...db[table]];
    
    // Simple WHERE clause parsing
    if (sql.includes('WHERE')) {
      const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/i);
      if (whereMatch) {
        const conditions = parseWhere(whereMatch[1], params);
        results = results.filter(row => matchesConditions(row, conditions));
      }
    }
    
    // Handle LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      results = results.slice(0, parseInt(limitMatch[1]));
    }
    
    // Handle ORDER BY
    if (sql.includes('ORDER BY')) {
      const orderMatch = sql.match(/ORDER BY\s+(\w+)\s*(DESC|ASC)?/i);
      if (orderMatch) {
        const col = orderMatch[1];
        const desc = orderMatch[2] === 'DESC';
        results.sort((a, b) => {
          if (desc) return (b[col] || 0) > (a[col] || 0) ? 1 : -1;
          return (a[col] || 0) > (b[col] || 0) ? 1 : -1;
        });
      }
    }
    
    return { rows: results };
  }
  
  if (sql.toLowerCase().includes('insert')) {
    // Handle INSERT
    const newRow = {};
    
    // Parse column names and values
    const colMatch = sql.match(/INSERT INTO \w+ \(([^)]+)\) VALUES \(([^)]+)\)/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map(c => c.trim());
      cols.forEach((col, i) => {
        let val = params[i];
        // Parse JSON columns
        if (['api_providers', 'skills', 'platforms', 'config', 'channels', 'gateway_config'].includes(col)) {
          try { val = JSON.parse(val); } catch(e) {}
        }
        newRow[col] = val;
      });
    }
    
    // Auto-generate ID if not provided
    if (!newRow.id) newRow.id = uuid();
    if (!newRow.created_at) newRow.created_at = new Date().toISOString();
    if (!newRow.updated_at) newRow.updated_at = new Date().toISOString();
    
    db[table].push(newRow);
    saveDb();
    
    return { rows: [{ ...newRow }], rowCount: 1 };
  }
  
  if (sql.toLowerCase().includes('update')) {
    // Handle UPDATE
    let updated = 0;
    const whereMatch = sql.match(/WHERE\s+(.+?)$/i);
    
    if (whereMatch) {
      const conditions = parseWhere(whereMatch[1], params.slice(1));
      
      db[table].forEach(row => {
        if (matchesConditions(row, conditions)) {
          // Parse SET clause
          const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
          if (setMatch) {
            const sets = parseSet(setMatch[1]);
            Object.assign(row, sets);
            row.updated_at = new Date().toISOString();
            updated++;
          }
        }
      });
    }
    
    saveDb();
    return { rowCount: updated };
  }
  
  if (sql.toLowerCase().includes('delete')) {
    // Handle DELETE
    const whereMatch = sql.match(/WHERE\s+(.+?)$/i);
    let deleted = 0;
    
    if (whereMatch) {
      const conditions = parseWhere(whereMatch[1], params);
      const beforeLen = db[table].length;
      db[table] = db[table].filter(row => !matchesConditions(row, conditions));
      deleted = beforeLen - db[table].length;
    }
    
    saveDb();
    return { rowCount: deleted };
  }
  
  return { rows: [] };
}

function getTableName(sql) {
  const match = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
  return match ? match[1].toLowerCase() : 'unknown';
}

function parseWhere(whereClause, params) {
  const conditions = {};
  let paramIndex = 0;
  
  // Replace $1, $2, etc with actual values
  whereClause = whereClause.replace(/\$(\d+)/g, (match, num) => {
    return JSON.stringify(params[parseInt(num) - 1]);
  });
  
  // Parse conditions
  const parts = whereClause.split(/\s+AND\s+/i);
  parts.forEach(part => {
    const match = part.match(/(\w+)\s*=\s*(.+)/);
    if (match) {
      let val = match[2].trim();
      try { val = JSON.parse(val); } catch(e) {}
      conditions[match[1]] = val;
    }
  });
  
  return conditions;
}

function matchesConditions(row, conditions) {
  for (const [key, val] of Object.entries(conditions)) {
    if (row[key] !== val) return false;
  }
  return true;
}

function parseSet(setClause) {
  const sets = {};
  const parts = setClause.split(',');
  parts.forEach(part => {
    const match = part.match(/(\w+)\s*=\s*(.+)/);
    if (match) {
      let val = match[2].trim();
      // Remove quotes if string
      if (val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      // Try JSON parse
      try { val = JSON.parse(val); } catch(e) {}
      sets[match[1]] = val;
    }
  });
  return sets;
}

// Initialize tables
async function initDb() {
  console.log('✅ JSON Database initialized');
  console.log('📁 Data file:', DB_FILE);
}

module.exports = {
  query,
  initDb,
  db,
  saveDb
};
