# HostClaw.ai

> 🐾 Automated OpenClaw Cloud Hosting with Built-in Payments

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

## 🚀 Quick Start

```bash
# Clone & setup
git clone https://github.com/yourusername/hostclaw.ai.git
cd hostclaw.ai

# Local development
cp api/.env.example api/.env
# Edit api/.env with your credentials

# Start with Docker
docker-compose up -d

# Or manually
cd api && npm install && npm run dev
```

## ✨ Features

- ⚡ **One-Click Deploy** - Deploy OpenClaw agents instantly
- 💳 **Built-in Payments** - Stripe integration for monetization  
- 🔒 **Enterprise Security** - SSL, DDoS protection, encryption
- 📱 **Multi-Channel** - Telegram, Discord, WhatsApp, Slack
- 🧠 **Long-Term Memory** - Persistent agent storage
- 📊 **Analytics Dashboard** - Real-time performance metrics
- 📧 **Email Notifications** - Welcome, alerts, reports
- 🎛️ **Admin Panel** - Full platform management

## 📁 Project Structure

```
hostclaw-website/
├── index.html          # Landing page
├── dashboard.html      # User dashboard
├── admin.html          # Admin panel
├── render.yaml         # Render deployment config
├── docker-compose.yml  # Local development
└── api/                # Backend API
    ├── server.js       # Express server
    ├── routes/         # API routes
    ├── models/         # Database models
    └── services/       # Business logic
```

## 🌐 Deploy to Render

1. Fork this repository
2. Create [Render](https://render.com) account
3. Click "New +" → "Blueprint"
4. Connect your repo
5. Set environment variables
6. Done! 🎉

See [RENDER_DEPLOY.md](RENDER_DEPLOY.md) for detailed instructions.

## 💻 Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JS
- **Backend**: Node.js, Express
- **Database**: PostgreSQL
- **Cache**: Redis
- **Queue**: Bull
- **Payments**: Stripe
- **Email**: Nodemailer
- **Hosting**: Render

## 📚 Documentation

- [Deployment Guide](RENDER_DEPLOY.md)
- [API Documentation](api/README.md)
- [Contributing](CONTRIBUTING.md)

## 📄 License

MIT © HostClaw.ai