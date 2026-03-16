const fs = require('fs');
const path = require('path');

let useJSON = true;

// JSON Database setup
const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let jsonDb = { users: [], agents: [], chat_messages: [], invoices: [], usage_logs: [] };

function loadJsonDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      jsonDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { console.log('Creating new database'); }
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

loadJsonDb();

// Parse PostgreSQL-style WHERE conditions
function parseWhere(sql, params) {
  const conditions = {};
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+AND|\s+OR|$)/i);
  if (whereMatch) {
    let clause = whereMatch[1];
    // Replace $1, $2, $3 with actual values
    params.forEach((param, i) => {
      const placeholder = '$' + (i + 1);
      if (clause.includes(placeholder)) {
        const paramStr = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : param;
        clause = clause.replace(placeholder, paramStr);
      }
    });
    
    // Parse conditions (email = 'test@test.com', etc)
    const parts = clause.split(/\s+AND\s+/i);
    parts.forEach(part => {
      part = part.trim();
      const match = part.match(/(\w+)\s*=\s*(.+)/);
      if (match) {
        let val = match[2].trim();
        // Remove quotes
        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
          val = val.slice(1, -1);
        }
        conditions[match[1]] = val;
      }
    });
  }
  return conditions;
}

function matches(row, conditions) {
  for (const [key, val] of Object.entries(conditions)) {
    if (String(row[key]) !== String(val)) return false;
  }
  return true;
}

// Main query function
async function query(sql, params = []) {
  const sqlLower = sql.toLowerCase();
  const tableMatch = sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/i);
  const table = tableMatch ? tableMatch[1].toLowerCase() : '';
  
  // Ensure table exists
  if (!jsonDb[table]) jsonDb[table] = [];
  
  // INSERT
  if (sqlLower.startsWith('insert')) {
    const newRow = { 
      id: uuid(), 
      created_at: new Date().toISOString(), 
      updated_at: new Date().toISOString() 
    };
    
    // Parse column names
    const colMatch = sql.match(/\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map(c => c.trim());
      cols.forEach((col, i) => {
        newRow[col] = params[i];
      });
    }
    
    jsonDb[table].push(newRow);
    saveJsonDb();
    return { rows: [newRow], rowCount: 1 };
  }
  
  // SELECT
  if (sqlLower.startsWith('select')) {
    let results = [...jsonDb[table]];
    
    // WHERE
    const conditions = parseWhere(sql, params);
    if (Object.keys(conditions).length > 0) {
      results = results.filter(row => matches(row, conditions));
    }
    
    // ORDER BY
    const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)(?:\s+(DESC|ASC))?/i);
    if (orderMatch) {
      const col = orderMatch[1];
      const desc = orderMatch[2]?.toUpperCase() === 'DESC';
      results.sort((a, b) => {
        const aVal = a[col] || '';
        const bVal = b[col] || '';
        if (desc) return aVal > bVal ? -1 : 1;
        return aVal > bVal ? 1 : -1;
      });
    }
    
    // LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      results = results.slice(0, parseInt(limitMatch[1]));
    }
    
    return { rows: results };
  }
  
  // UPDATE
  if (sqlLower.startsWith('update')) {
    const conditions = parseWhere(sql, params.slice(1)); // Skip SET params
    let updated = 0;
    
    jsonDb[table].forEach(row => {
      if (matches(row, conditions)) {
        // Parse SET clause
        const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
        if (setMatch) {
          const sets = setMatch[1].split(',');
          sets.forEach(set => {
            const m = set.trim().match(/(\w+)\s*=\s*\$(\d+)/);
            if (m) {
              const col = m[1];
              const paramIdx = parseInt(m[2]) - 1;
              row[col] = params[paramIdx];
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
  if (sqlLower.startsWith('delete')) {
    const conditions = parseWhere(sql, params);
    const beforeLen = jsonDb[table].length;
    jsonDb[table] = jsonDb[table].filter(row => !matches(row, conditions));
    const deleted = beforeLen - jsonDb[table].length;
    if (deleted > 0) saveJsonDb();
    return { rowCount: deleted };
  }
  
  return { rows: [] };
}

async function initDb() {
  console.log('✅ JSON database ready');
}

module.exports = { initDb, query };
