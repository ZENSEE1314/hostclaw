# 🔧 Post-Deploy Setup Guide

## Step 1: Run Database Migrations

Go to Render Dashboard → **hostclaw-api** → **Shell**

**You're already in the `/api` directory**, just run:
```bash
npm run migrate
```

Or if you need the full path:
```bash
node config/migrate.js
```

## Step 2: Create Admin User

In the same Shell (hostclaw-api), run:
```bash
node -e "
const bcrypt = require('bcryptjs');
const { query } = require('./config/database');
const crypto = require('crypto');

async function createAdmin() {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 12);
    const userId = crypto.randomUUID();
    
    await query(\`
      INSERT INTO users (id, email, password, name, plan, credits, has_paid) 
      VALUES (\$1, \$2, \$3, \$4, \$5, \$6, 1)
      ON CONFLICT (email) DO UPDATE SET has_paid = 1, plan = 'enterprise'
    \`, [userId, 'admin@hostclaw.ai', hashedPassword, 'Admin', 'enterprise', 1000]);
    
    console.log('✅ Admin created successfully!');
    console.log('Email: admin@hostclaw.ai');
    console.log('Password: admin123');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
  process.exit(0);
}

createAdmin();
"
```

## Step 3: Set Environment Variables

Go to Render Dashboard → **hostclaw-api** → **Environment** → **Add Environment Variable**

### Required (at least one AI provider):
```
OPENAI_API_KEY=sk-your-openai-key-here
```

### Optional but recommended:
```
# For more AI models
ANTHROPIC_API_KEY=sk-ant-your-key-here

# For Google login
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# For payments
STRIPE_SECRET_KEY=sk_live_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# For email notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# For WhatsApp integration
WHATSAPP_TOKEN=your-whatsapp-token
WHATSAPP_PHONE_ID=your-phone-id

# For Telegram integration
TELEGRAM_BOT_TOKEN=your-bot-token
```

**After adding env vars, the service will auto-restart.**

## Step 4: Test the API

Visit: `https://hostclaw-api.onrender.com/health`

Should return:
```json
{
  "status": "ok",
  "timestamp": "2026-03-18T...",
  "version": "1.0.0",
  "users": 1
}
```

## Step 5: Login to Admin

Visit: `https://hostclaw-web.onrender.com/admin.html`

Login with:
- **Email:** `admin@hostclaw.ai`
- **Password:** `admin123`

## Step 6: Create Your First Agent

1. Go to **Agents** section in admin
2. Click **Create Agent**
3. Fill in:
   - **Name:** "My Bot"
   - **Model:** Select GPT-4o or Claude
   - **Description:** "A helpful assistant"
4. Click **Save**
5. Click **Deploy**

## Step 7: Test Chat

1. Go to **Chat** section
2. Select your agent
3. Send a message!

## Troubleshooting

### "Failed to fetch" or "Network error"
- Check API health: Visit `/health` endpoint
- Check browser console (F12) for CORS errors
- Verify `FRONTEND_URL` env var is set to your web URL

### "Database error" or "table does not exist"
- Run migrations again: `npm run migrate`
- Check database connection in Render logs

### "Agent deployment failed"
- Check AI provider API key is set and valid
- Verify user has `has_paid = 1` in database
- Check API logs in Render Dashboard → Logs

### "Chat not responding"
- Make sure agent status is "running"
- Check AI provider has available quota/credits
- Verify API key is valid (test with curl)

### "Cannot login"
- Make sure admin user was created
- Check password is correct
- Try creating user again

## Quick Commands Reference

**Check database:**
```bash
node -e "const {query} = require('./config/database'); query('SELECT COUNT(*) FROM users').then(r => console.log('Users:', r.rows[0].count))"
```

**List all users:**
```bash
node -e "const {query} = require('./config/database'); query('SELECT email, name, plan, has_paid FROM users').then(r => console.log(r.rows))"
```

**Reset admin password:**
```bash
node -e "const bcrypt = require('bcryptjs'); const {query} = require('./config/database'); bcrypt.hash('newpassword', 12).then(h => query('UPDATE users SET password = \$1 WHERE email = \$2', [h, 'admin@hostclaw.ai']).then(() => console.log('Password updated')))"
```

## Need Help?

- 📧 Email: support@hostclaw.ai
- 💬 Discord: https://discord.gg/hostclaw
- 📚 Docs: https://docs.hostclaw.ai
