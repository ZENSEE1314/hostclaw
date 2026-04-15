const bcrypt = require('bcryptjs');
const { query } = require('./config/database');

async function createAdminUser() {
  const email = process.argv[2] || 'admin@chatsai.ai';
  const password = process.argv[3] || 'admin123';
  const name = 'Admin User';
  
  console.log('Creating admin user:', email);
  
  try {
    // Check if user exists
    const existing = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    
    if (existing.rows.length > 0) {
      console.log('User already exists:', email);
      console.log('User ID:', existing.rows[0].id);
      console.log('Updating to admin...');
      
      // Update to ensure has_paid is true
      await query('UPDATE users SET has_paid = 1 WHERE id = $1', [existing.rows[0].id]);
      console.log('User updated with has_paid = true');
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
    
    console.log('✅ Admin user created successfully!');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('User ID:', userId);
    console.log('');
    console.log('You can now login at: https://hostclaw-web.onrender.com/admin.html');
    
  } catch (err) {
    console.error('Error creating admin:', err);
  }
}

createAdminUser();
