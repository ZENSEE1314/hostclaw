# HostClaw.ai Platform

A fully automated cloud platform for deploying OpenClaw AI agents with integrated payment processing.

## Features

- ⚡ **One-Click Deploy** - Deploy OpenClaw agents instantly
- 💳 **Built-in Payments** - Stripe integration for monetization
- 🔒 **Enterprise Security** - SSL, DDoS protection, encrypted storage
- 📱 **Multi-Channel** - Telegram, Discord, WhatsApp, Slack support
- 🧠 **Long-Term Memory** - Persistent agent memory
- 📊 **Analytics Dashboard** - Real-time performance metrics
- 🔄 **Auto-Scaling** - Elastic infrastructure
- 🛠️ **Custom Integrations** - API and workflow support

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JS
- **Backend**: Node.js/Express (API)
- **Database**: PostgreSQL
- **Cache**: Redis
- **Queue**: Bull/BullMQ
- **Payments**: Stripe
- **Infrastructure**: Docker, Kubernetes
- **Monitoring**: Prometheus, Grafana

## Project Structure

```
hostclaw-website/
├── index.html          # Landing page
├── dashboard.html      # User dashboard
├── api/               # Backend API
│   ├── server.js      # Express server
│   ├── routes/        # API routes
│   ├── models/        # Database models
│   ├── services/      # Business logic
│   └── workers/       # Background jobs
├── config/            # Configuration files
├── scripts/           # Deployment scripts
└── docs/             # Documentation
```

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Stripe account

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/hostclaw.ai.git
cd hostclaw.ai

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Run migrations
npm run migrate

# Start development server
npm run dev
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/hostclaw

# Redis
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Infrastructure
DOCKER_REGISTRY=ghcr.io/yourusername
KUBECONFIG_PATH=/path/to/kubeconfig
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh` - Refresh token

### Agents
- `GET /api/agents` - List user agents
- `POST /api/agents` - Create new agent
- `GET /api/agents/:id` - Get agent details
- `PATCH /api/agents/:id` - Update agent
- `DELETE /api/agents/:id` - Delete agent
- `POST /api/agents/:id/deploy` - Deploy agent
- `POST /api/agents/:id/stop` - Stop agent
- `GET /api/agents/:id/logs` - Get agent logs

### Billing
- `GET /api/billing/credits` - Get credit balance
- `POST /api/billing/credits` - Add credits
- `GET /api/billing/invoices` - List invoices
- `POST /api/billing/subscribe` - Subscribe to plan
- `POST /api/billing/cancel` - Cancel subscription

### Webhooks
- `POST /webhooks/stripe` - Stripe webhook handler
- `POST /webhooks/github` - GitHub webhook handler

## Deployment Automation

The platform uses a sophisticated deployment pipeline:

1. **Build Phase**
   - Clone user configuration
   - Install dependencies
   - Build Docker image
   - Push to registry

2. **Deploy Phase**
   - Create Kubernetes namespace
   - Deploy agent pods
   - Configure ingress
   - Setup SSL certificates
   - Configure monitoring

3. **Connect Phase**
   - Register webhooks
   - Test channel connections
   - Verify agent health
   - Send confirmation

## Payment Integration

### Stripe Setup

1. Create Stripe account
2. Configure products and prices
3. Add webhook endpoint: `https://api.hostclaw.ai/webhooks/stripe`
4. Copy API keys to environment variables

### Payment Flow

1. User subscribes to plan
2. Stripe creates subscription
3. Webhook updates user credits
4. Credits deducted based on usage
5. Auto-recharge when low (optional)

### Revenue Model

- Platform fee: 10% of transactions
- Monthly subscription plans
- Usage-based overage charges
- Enterprise custom pricing

## Monitoring

### Metrics Collected

- Agent uptime/availability
- Message volume and latency
- API response times
- Error rates
- Resource utilization
- Revenue metrics

### Alerts

- Agent downtime
- High error rates
- Low credit balance
- Security incidents
- Infrastructure issues

## Security

- All data encrypted at rest and in transit
- SOC 2 Type II compliant infrastructure
- Regular security audits
- DDoS protection via Cloudflare
- API rate limiting
- IP whitelisting options
- Audit logging

## Support

- Documentation: https://docs.hostclaw.ai
- Community Discord: https://discord.gg/hostclaw
- Email: support@hostclaw.ai
- Status: https://status.hostclaw.ai

## License

MIT License - see LICENSE file for details

## Roadmap

- [ ] Custom domain support
- [ ] Team collaboration features
- [ ] Advanced analytics
- [ ] Marketplace for agent templates
- [ ] Mobile app
- [ ] Enterprise SSO
- [ ] Multi-region deployment
- [ ] AI-powered agent optimization
