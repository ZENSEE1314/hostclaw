const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let jsonDb = { users: [], agents: [], chat_messages: [], invoices: [], usage_logs: [] };

function loadJsonDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      jsonDb = JSON.parse(data);
      console.log('Loaded DB with', jsonDb.users?.length || 0, 'users');
    } catch (e) { 
      console.log('Creating new database'); 
    }
  }
}

function saveJsonDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(jsonDb, null, 2));
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

loadJsonDb();

function parseWhere(sql, params) {
  const conditions = {};
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+AND|\s+OR|$)/i);
  
  if (whereMatch) {
    let clause = whereMatch[1];
    // Replace $1, $2 with actual param values
    params.forEach((param, i) => {
      const placeholder = '$' + (i + 1);
      if (clause.includes(placeholder)) {
        let paramStr;
        if (typeof param === 'string') {
          paramStr = param; // Don't add quotes, we'll handle that
        } else {
          paramStr = String(param);
        }
        clause = clause.replace(placeholder, '__PARAM' + i + '__');
      }
    });
    
    // Now replace the placeholders with actual values
    params.forEach((param, i) => {
      let paramStr;
      if (typeof param === 'string') {
        paramStr = param; // Use as-is for string comparison
      } else {
        paramStr = String(param);
      }
      clause = clause.replace('__PARAM' + i + '__', paramStr);
    });
    
    // Parse conditions
    const parts = clause.split(/\s+AND\s+/i);
    parts.forEach(part => {
      part = part.trim();
      // Match column = value
      const match = part.match(/(\w+)\s*=\s*(.+)/);
      if (match) {
        let col = match[1].trim();
        let val = match[2].trim();
        // Remove quotes if present
        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
          val = val.slice(1, -1);
        }
        conditions[col] = val;
      }
    });
  }
  
  return conditions;
}

function matches(row, conditions) {
  for (const [key, val] of Object.entries(conditions)) {
    // Convert both to string for comparison
    if (String(row[key]) !== String(val)) {
      return false;
    }
  }
  return true;
}

async function query(sql, params = []) {
  const sqlLower = sql.toLowerCase();
  const tableMatch = sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/i);
  const table = (tableMatch ? tableMatch[1] : 'unknown').toLowerCase();
  
  console.log('Query:', sql.substring(0, 50), 'table:', table, 'params:', params);
  
  // Ensure table exists
  if (!jsonDb[table]) {
    jsonDb[table] = [];
  }
  
  // INSERT
  if (sqlLower.startsWith('insert')) {
    const newRow = { 
      id: uuid(), 
      created_at: new Date().toISOString(), 
      updated_at: new Date().toISOString() 
    };
    
    // Parse column names from SQL
    const colMatch = sql.match(/\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map(c => c.trim());
      cols.forEach((col, i) => {
        if (params[i] !== undefined) {
          newRow[col] = params[i];
        }
      });
    }
    
    jsonDb[table].push(newRow);
    saveJsonDb();
    console.log('Inserted into', table, 'id:', newRow.id);
    return { rows: [newRow], rowCount: 1 };
  }
  
  // SELECT
  if (sqlLower.startsWith('select')) {
    let results = [...jsonDb[table]];
    
    // Parse WHERE conditions
    const conditions = parseWhere(sql, params);
    console.log('Conditions:', conditions);
    
    if (Object.keys(conditions).length > 0) {
      results = results.filter(row => matches(row, conditions));
    }
    
    console.log('Found', results.length, 'results');
    
    // LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      results = results.slice(0, parseInt(limitMatch[1]));
    }
    
    return { rows: results };
  }
  
  // UPDATE
  if (sqlLower.startsWith(' update')) {
    const conditions = parseWhere(sql, params.slice(1));
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
              if (params[paramIdx] !== undefined) {
                row[col] = params[paramIdx];
              }
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
  
  return { rows: [] };
}

async function initDb() {
  console.log('✅ JSON DB ready, users:', jsonDb.users?.length || 0);
}

module.exports = { initDb, query };
