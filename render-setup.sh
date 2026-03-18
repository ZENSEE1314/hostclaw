#!/bin/bash

# Render Post-Deploy Setup Script
# Run this in Render Shell after first deployment

echo "🚀 Setting up HostClaw on Render..."

# 1. Run database migrations
echo "📦 Running database migrations..."
cd api && npm run migrate

# 2. Create first admin user
echo "👤 Creating admin user..."
node -e "
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { query } = require('./config/database');
const crypto = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Admin email: ', (email) => {
  rl.question('Admin password: ', async (password) => {
    try {
      const hashedPassword = await bcrypt.hash(password, 12);
      const userId = crypto.randomUUID();
      
      await query(\`
        INSERT INTO users (id, email, password, name, plan, credits, has_paid, api_providers, skills, default_provider) 
        VALUES (\$1, \$2, \$3, \$4, \$5, \$6, 1, '{}', '[]', 'openai')
        ON CONFLICT (email) DO NOTHING
      \`, [userId, email.toLowerCase(), hashedPassword, 'Admin', 'enterprise', 1000]);
      
      console.log('✅ Admin user created:', email);
      process.exit(0);
    } catch (err) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
  });
});
"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Set environment variables in Render Dashboard"
echo "2. Add AI provider API keys (OpenAI, Anthropic, etc.)"
echo "3. Configure Stripe for payments (optional)"
echo "4. Set up WhatsApp/Telegram webhooks"
