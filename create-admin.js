const bcrypt = require('bcryptjs');
const { query } = require('./config/database');
const crypto = require('crypto');

async function createAdmin() {
    try {
        const hashedPassword = await bcrypt.hash('admin123', 12);
        const userId = crypto.randomUUID();
        
        const sql = `
            INSERT INTO users (id, email, password, name, plan, credits, has_paid) 
            VALUES ($1, $2, $3, $4, $5, $6, 1)
            ON CONFLICT (email) DO UPDATE 
            SET has_paid = 1, plan = 'enterprise', credits = 1000
        `;
        
        const params = [userId, 'admin@hostclaw.ai', hashedPassword, 'Admin', 'enterprise', 1000];
        
        await query(sql, params);
        
        console.log('✅ Admin user created successfully!');
        console.log('Email: admin@hostclaw.ai');
        console.log('Password: admin123');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

createAdmin();
