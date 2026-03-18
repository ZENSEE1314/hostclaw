# 🔧 Post-Deploy Setup Guide

## Step 1: Run Database Migrations

Go to Render Dashboard → **hostclaw-api** → **Shell**

Run:
```bash
cd api && npm run migrate
```

## Step 2: Create Admin User

In the same Shell, run:
```bash
cd api && node -e "
const bcrypt = require('bcryptjs');
const { query } = require('./config/database');
const crypto = require('crypto');

async function createAdmin() {
  const hashedPassword = await bcrypt.hash('admin123', 12);
  const userId = crypto.randomUUID();
  
  await query(\`
    INSERT INTO users (id, email, password, name, plan, credits, has_paid) 
    VALUES (\$1, \$2, \$3, \$4, \$5, \$6, 1)
    ON CONFLICT (email) DO UPDATE SET has_paid = 1
  \`, [userId, 'admin@hostclaw.ai', hashedPassword, 'Admin', 'enterprise', 1000]);
  
  console.log('Admin created: admin@hostclaw.ai / admin123');
}

createAdmin().catch(console.error);
"
```

## Step 3: Set Environment Variables

Go to Render Dashboard → **hostclaw-api** → **Environment**

Add these required variables:

```
# AI Providers (at least one)
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-key

# Optional: Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Optional: Stripe Payments
STRIPE_SECRET_KEY=sk_live_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Optional: Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Optional: WhatsApp
WHATSAPP_TOKEN=your-whatsapp-token
WHATSAPP_PHONE_ID=your-phone-id

# Optional: Telegram
TELEGRAM_BOT_TOKEN=your-bot-token
```

## Step 4: Test the API

Visit: `https://hostclaw-api.onrender.com/health`

Should return:
```json
{
  "status": "ok",
  "timestamp": "...",
  "version": "1.0.0"
}
```

## Step 5: Login to Admin

Visit: `https://hostclaw-web.onrender.com/admin.html`

Login with:
- Email: `admin@hostclaw.ai`
- Password: `admin123`

## Step 6: Create Your First Agent

1. Go to **Agents** section
2. Click **Create Agent**
3. Fill in:
   - Name: "My Bot"
   - Model: GPT-4o or Claude
   - Description: "A helpful assistant"
4. Click **Deploy**

## Troubleshooting

### "Failed to fetch" errors
- Check if API is running: Visit `/health` endpoint
- Check browser console for CORS errors
- Verify `FRONTEND_URL` env var matches your domain

### Database errors
- Run migrations again: `cd api && npm run migrate`
- Check `DATABASE_URL` is set correctly

### Agent deployment fails
- Check AI provider API keys are set
- Verify user has credits (`has_paid = 1`)
- Check API logs in Render Dashboard

### Chat not working
- Make sure agent is deployed (status = "running")
- Check AI provider has available quota
- Verify API keys are valid

## Need Help?

- 📧 Email: support@hostclaw.ai
- 💬 Discord: https://discord.gg/hostclaw
