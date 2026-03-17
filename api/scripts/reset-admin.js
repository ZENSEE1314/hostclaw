const bcrypt = require('bcryptjs');
const { query } = require('./config/database');

async function createAdminUser() {
  const email = process.argv[2] || 'admin@hostclaw.ai';
  const password = process.argv[3] || 'admin123456';
  const name = process.argv[4] || 'Admin User';
  
  console.log('Creating admin user:', email);
  
  try {
    // Check if user exists
    const existing = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    
    if (existing.rows.length > 0) {
      console.log('User already exists:', email);
      console.log('Updating password...');
      
      const hashedPassword = await bcrypt.hash(password, 12);
      await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, existing.rows[0].id]);
      console.log('Password updated!');
      console.log('Email:', email);
      console.log('Password:', password);
      return;
    }
    
    // Create new admin user
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = require('crypto').randomUUID();
    
    await query(
      `INSERT INTO users (id, email, password, name, plan, credits, has_paid, api_providers, skills, default_provider) 
       VALUES ($1, $2, $3, $4, $5, $6, 1, '{}', '[]', 'openai')`,
      [userId, email.toLowerCase(), hashedPassword, name, 'enterprise', 1000]
    );
    
    console.log('✅ Admin user created!');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('User ID:', userId);
    
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

createAdminUser();
