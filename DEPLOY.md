# 🚀 Deploy HostClaw to Render - Complete Guide

This guide will walk you through deploying HostClaw.ai to Render so you can use OpenClaw on WhatsApp or Telegram.

## 📋 Prerequisites

- GitHub account
- Render account (free)
- (Optional) Stripe account for payments
- (Optional) WhatsApp Business account
- (Optional) Telegram account

## 🎯 Deployment Steps

### Step 1: Prepare Your Repository

1. **Fork or clone this repository**
   ```bash
   git clone https://github.com/yourusername/hostclaw.ai.git
   cd hostclaw.ai
   ```

2. **Make sure all files are committed**
   ```bash
   git add .
   git commit -m "Ready for Render deployment"
   git push origin main
   ```

### Step 2: Deploy to Render

#### Option A: One-Click Deploy (Easiest)

1. Go to your Render Dashboard: https://dashboard.render.com
2. Click "New +" → "Blueprint"
3. Connect your GitHub repository
4. Render will read `render.yaml` and create all services automatically

#### Option B: Manual Deploy

**Create Static Site (Frontend):**
1. Click "New +" → "Static Site"
2. Connect your GitHub repo
3. Set:
   - Name: `hostclaw-web`
   - Build Command: `echo "No build needed"`
   - Publish Directory: `./`
4. Click "Create Static Site"

**Create Web Service (API):**
1. Click "New +" → "Web Service"
2. Connect your GitHub repo
3. Set:
   - Name: `hostclaw-api`
   - Root Directory: `api`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`
4. Click "Create Web Service"

**Create Database:**
1. Click "New +" → "PostgreSQL"
2. Name: `hostclaw-db`
3. Plan: Free
4. Click "Create Database"

### Step 3: Configure Environment Variables

**For hostclaw-api service:**

Go to Render Dashboard → hostclaw-api → Environment → Add Environment Variables:

```
# Required
NODE_ENV=production
PORT=10000
JWT_SECRET=generate-a-random-secret-here
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://hostclaw-web.onrender.com

# Database (auto-populated from database)
DATABASE_URL=postgresql://...

# Stripe (for payments)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# AI Providers (optional)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 4: Setup Stripe (Optional, for payments)

1. Go to https://dashboard.stripe.com
2. Developers → Webhooks
3. Add endpoint: `https://hostclaw-api.onrender.com/webhooks/stripe`
4. Select events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.created`
   - `customer.subscription.deleted`
5. Copy webhook signing secret
6. Add to Render environment variables as `STRIPE_WEBHOOK_SECRET`

### Step 5: Run Database Migrations

1. Go to Render Dashboard → hostclaw-api → Shell
2. Run:
   ```bash
   cd api && npm run migrate
   ```

### Step 6: Verify Deployment

**Check API Health:**
```bash
curl https://hostclaw-api.onrender.com/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2026-03-17T...",
  "version": "1.0.0"
}
```

**Visit Your Site:**
Open `https://hostclaw-web.onrender.com` in your browser

## 📱 Using Your Deployed HostClaw

### Deploy to WhatsApp

1. **Sign up** at `https://hostclaw-web.onrender.com/signup.html`
2. **Create an agent:**
   - Click "Create Agent"
   - Name: "My WhatsApp Bot"
   - Choose AI model (OpenAI GPT-4, Claude, etc.)
   - Set personality/instructions
3. **Connect WhatsApp:**
   - Go to Channels tab
   - Click "WhatsApp"
   - Choose method:
     - **WhatsApp Cloud API**: Scan QR code
     - **WhatsApp Business API**: Enter credentials
4. **Deploy:**
   - Click "Deploy"
   - Wait for "Connected" status
   - Start messaging your WhatsApp number!

### Deploy to Telegram

1. **Sign up** at your deployed URL
2. **Create an agent** (same as above)
3. **Get Telegram Bot Token:**
   - Open Telegram
   - Message @BotFather
   - Send `/newbot`
   - Follow instructions
   - Copy the API token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. **Connect Telegram:**
   - Go to Channels tab
   - Click "Telegram"
   - Paste your bot token
5. **Deploy:**
   - Click "Deploy"
   - Find your bot on Telegram
   - Start chatting!

## 🔧 Troubleshooting

### API Returns 502 Error
- Check that `hostclaw-api` service is running
- Check logs in Render Dashboard
- Verify `PORT` is set to `10000`

### Database Connection Errors
- Run migrations: `cd api && npm run migrate`
- Check `DATABASE_URL` is set correctly
- Verify database is in same region as API

### WhatsApp Not Connecting
- Verify WhatsApp Business API credentials
- Check webhook URL is accessible
- Ensure phone number is registered

### Telegram Not Responding
- Verify bot token is correct
- Check webhook is set (HostClaw does this automatically)
- Make sure bot isn't blocked

### Static Site Shows 404
- Check `staticPublishPath` is set to `./`
- Verify `_redirects` file exists
- Check routes in `render.yaml`

## 📊 Monitoring Your Deployment

**View Logs:**
- Render Dashboard → Service → Logs

**Set Up Alerts:**
- Render Dashboard → Service → Settings → Alerts

**Health Checks:**
- API: `https://hostclaw-api.onrender.com/health`
- Web: `https://hostclaw-web.onrender.com`

## 💰 Cost Management

**Free Tier Limits:**
- Static Site: Unlimited
- Web Service: 750 hours/month (sleeps after 15 min idle)
- Database: 90 days free, then $15/month

**To Keep Free:**
- Use free database plan
- Let web service sleep (wakes on request)
- Monitor usage in Render Dashboard

**Upgrade If:**
- Need 24/7 uptime → $7/month web service
- Need persistent database → $15/month
- Need more resources → Standard plan

## 🔄 Updating Your Deployment

1. Make changes locally
2. Commit and push:
   ```bash
   git add .
   git commit -m "Update: description"
   git push origin main
   ```
3. Render automatically redeploys

## 📞 Need Help?

- 📧 Email: support@hostclaw.ai
- 💬 Discord: https://discord.gg/hostclaw
- 📚 Docs: https://docs.hostclaw.ai

---

**Congratulations! Your OpenClaw agent is now live on WhatsApp or Telegram! 🎉**
