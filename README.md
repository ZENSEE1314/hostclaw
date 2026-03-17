# 🚀 HostClaw.ai - Deploy OpenClaw to WhatsApp & Telegram

A complete cloud hosting platform for OpenClaw AI agents with instant deployment to WhatsApp and Telegram.

## ✨ Features

- **⚡ 3-Step Deployment** - Get your AI agent on WhatsApp/Telegram in under 3 minutes
- **💬 WhatsApp Integration** - Connect via WhatsApp Cloud API or Business API
- **✈️ Telegram Integration** - Simple bot token setup with @BotFather
- **🔒 Enterprise Security** - SSL, DDoS protection, encrypted storage
- **🧠 Long-Term Memory** - Persistent agent memory across conversations
- **📊 Analytics Dashboard** - Real-time performance metrics
- **🔄 Auto-Scaling** - Elastic cloud infrastructure
- **💳 Built-in Payments** - Stripe integration for monetization

## 🚀 Quick Deploy to Render

### Step 1: Fork/Clone This Repository

```bash
git clone https://github.com/yourusername/hostclaw.ai.git
cd hostclaw.ai
```

### Step 2: Push to GitHub

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

### Step 3: Deploy to Render

**Option A: One-Click Deploy (Recommended)**

Click this button:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

**Option B: Manual Deploy**

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click "New +" → "Blueprint"
3. Connect your GitHub repository
4. Render will automatically create:
   - ✅ Static Site (Frontend) - Free tier
   - ✅ Web Service (API) - Standard tier
   - ✅ PostgreSQL Database - Free tier

### Step 4: Configure Environment Variables

After deployment, set these in your Render Dashboard:

**For hostclaw-api service:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 5: Setup Stripe Webhook

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://hostclaw-api.onrender.com/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.created`
4. Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

### Step 6: Run Database Migrations

In Render Dashboard → hostclaw-api → Shell:
```bash
cd api && npm run migrate
```

## 📱 Using Your Deployed Agent

### Deploy to WhatsApp

1. **Sign up** at your deployed URL (e.g., `https://hostclaw-web.onrender.com`)
2. **Create an agent** - Give it a name and personality
3. **Go to Channels → WhatsApp**
4. **Choose your method:**
   - **WhatsApp Cloud API**: Scan QR code with your WhatsApp
   - **WhatsApp Business API**: Enter your API credentials
5. **Click Deploy** - Your agent is now live on WhatsApp!

### Deploy to Telegram

1. **Sign up** at your deployed URL
2. **Create an agent** - Configure name and AI model
3. **Go to Channels → Telegram**
4. **Get your bot token:**
   - Message @BotFather on Telegram
   - Create new bot with `/newbot`
   - Copy the API token
5. **Paste token** in HostClaw dashboard
6. **Click Deploy** - Start chatting with your bot!

## 🌐 Your Live URLs

After deployment:

| Service | URL | Purpose |
|---------|-----|---------|
| 🌐 Website | `https://hostclaw-web.onrender.com` | Landing page & dashboard |
| ⚙️ API | `https://hostclaw-api.onrender.com` | Backend API |
| 📊 Health | `https://hostclaw-api.onrender.com/health` | Status check |

## 💰 Pricing on Render

| Component | Free Tier | Paid Tier |
|-----------|-----------|-----------|
| Static Site | $0 | $0 |
| Web Service | $0 (sleeps after 15min) | $7/month |
| PostgreSQL | $0 (90 days) | $15/month |
| **Total** | **$0** | **$22/month** |

**For production:** Use paid tiers for 24/7 uptime.

## 🛠️ Local Development

```bash
# Clone repository
git clone https://github.com/yourusername/hostclaw.ai.git
cd hostclaw.ai

# Setup API
cd api
cp .env.example .env
# Edit .env with your credentials
npm install
npm run migrate
npm run dev

# In another terminal, serve frontend
# Use any static server, e.g.:
npx serve ..
```

## 📁 Project Structure

```
hostclaw-website/
├── index.html              # Landing page (WhatsApp/Telegram focused)
├── dashboard.html          # User dashboard
├── login.html              # Login page
├── signup.html             # Signup page
├── api/                    # Backend API
│   ├── server.js           # Express server
│   ├── routes/             # API routes
│   │   ├── auth.js         # Authentication
│   │   ├── agents.js       # Agent management
│   │   ├── billing.js      # Payments
│   │   ├── webhooks.js     # Webhook handlers
│   │   └── ...
│   ├── services/           # Business logic
│   └── package.json
├── render.yaml             # Render deployment config
└── static.json             # Static site config
```

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Agents
- `GET /api/agents` - List agents
- `POST /api/agents` - Create agent
- `POST /api/agents/:id/deploy` - Deploy to WhatsApp/Telegram
- `POST /api/agents/:id/stop` - Stop agent

### Billing
- `GET /api/billing/credits` - Get credit balance
- `POST /api/billing/credits` - Add credits

### Webhooks
- `POST /webhooks/stripe` - Stripe webhook handler
- `POST /webhooks/whatsapp` - WhatsApp webhook
- `POST /webhooks/telegram` - Telegram webhook

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| 502 Error | Check API service is running on Render |
| DB errors | Run migrations in Render Shell |
| WhatsApp not connecting | Verify WhatsApp Business API credentials |
| Telegram not responding | Check bot token is correct |
| Emails not sending | Verify SMTP credentials |

## 📞 Support

- 📧 Email: support@hostclaw.ai
- 💬 Discord: https://discord.gg/hostclaw
- 📚 Docs: https://docs.hostclaw.ai

## 📄 License

MIT License - see LICENSE file for details.

---

**Made with ❤️ for the OpenClaw community**
