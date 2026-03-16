# HostClaw.ai - Render Deployment Guide

## 🚀 Quick Deploy to Render

### Option 1: One-Click Deploy (Recommended)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yourusername/hostclaw.ai)

### Option 2: Manual Deploy

1. **Fork/Clone this repository**
   ```bash
   git clone https://github.com/yourusername/hostclaw.ai.git
   cd hostclaw.ai
   ```

2. **Create a new Web Service on Render**
   - Go to [dashboard.render.com](https://dashboard.render.com)
   - Click "New +" → "Blueprint"
   - Connect your GitHub/GitLab repository
   - Render will detect `render.yaml` and create all services

3. **Set environment variables**
   After deployment, go to each service and set:

   **For API Service:**
   - `STRIPE_SECRET_KEY` - Your Stripe Secret Key
   - `STRIPE_PUBLISHABLE_KEY` - Your Stripe Publishable Key  
   - `STRIPE_WEBHOOK_SECRET` - Will be set after webhook setup
   - `SMTP_USER` - Gmail address for sending emails
   - `SMTP_PASS` - Gmail App Password

4. **Configure Stripe Webhook**
   - Go to Stripe Dashboard → Developers → Webhooks
   - Add endpoint: `https://hostclaw-api.onrender.com/webhooks/stripe`
   - Select events:
     - `checkout.session.completed`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
     - `customer.subscription.created`
     - `customer.subscription.deleted`
   - Copy the webhook signing secret
   - Add to Render environment variables as `STRIPE_WEBHOOK_SECRET`

5. **Run database migrations**
   - Go to Render Dashboard → hostclaw-api → Shell
   - Run: `cd api && npm run migrate`

6. **Done!** 
   - Web App: `https://hostclaw.onrender.com`
   - API: `https://hostclaw-api.onrender.com`
   - Admin: `https://hostclaw.onrender.com/admin`

---

## 📋 Services Created

| Service | Type | Purpose |
|---------|------|---------|
| hostclaw-api | Web | Backend API server |
| hostclaw-web | Static | Frontend (landing + dashboard) |
| hostclaw-worker | Worker | Background jobs (emails, reports) |
| hostclaw-db | PostgreSQL | Database |
| hostclaw-redis | Redis | Queue & caching |

---

## 🔧 Custom Domain Setup

1. Go to Render Dashboard → hostclaw-web → Settings → Custom Domains
2. Add your domain (e.g., `hostclaw.ai`)
3. Add the CNAME record to your DNS
4. Wait for SSL certificate to be issued
5. Update `FRONTEND_URL` environment variable

---

## 💡 Post-Deploy Configuration

### 1. Create Admin User

Connect to database via Render Shell:
```bash
cd api
node -e "
const User = require('./models/user');
User.createUser({
  email: 'admin@hostclaw.ai',
  password: 'YourSecurePassword123!',
  name: 'Admin',
  plan: 'enterprise'
}).then(u => console.log('Admin created:', u.email));
"
```

### 2. Configure SMTP (Gmail)

1. Enable 2-Factor Authentication on your Gmail
2. Generate App Password: Google Account → Security → App Passwords
3. Add to environment variables:
   - `SMTP_USER`: your.email@gmail.com
   - `SMTP_PASS`: your-app-password

### 3. Test Deployment

```bash
# Test API health
curl https://hostclaw-api.onrender.com/health

# Test registration
curl -X POST https://hostclaw-api.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123","name":"Test"}'
```

---

## 🐛 Troubleshooting

### API returns 502 Bad Gateway
- Check if API service is running in Render Dashboard
- Check logs for errors
- Verify all environment variables are set

### Database connection errors
- Verify `DATABASE_URL` is set correctly
- Run migrations: `cd api && npm run migrate`

### Emails not sending
- Check SMTP credentials
- Verify Gmail App Password is correct
- Check worker service logs

### Stripe webhooks not working
- Verify webhook URL is correct
- Check `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
- Check API logs for webhook errors

---

## 💰 Render Pricing

| Plan | Cost | Notes |
|------|------|-------|
| Web Service | Free / $7/mo | Free tier sleeps after 15 min idle |
| Worker | Free / $7/mo | Free tier sleeps after 15 min idle |
| PostgreSQL | Free / $15/mo | Free = 90 days then deleted |
| Redis | Free / $15/mo | Free = 30 MB max |

**For production:** Upgrade to paid plans for 24/7 uptime and persistent data.

---

## 🔒 Security Checklist

- [ ] Change default JWT_SECRET to a strong random string
- [ ] Enable HTTPS only (Render does this automatically)
- [ ] Set up Stripe webhook signature verification
- [ ] Use strong admin password
- [ ] Enable database backups on Render
- [ ] Set up log monitoring

---

## 📞 Support

- Render Docs: https://render.com/docs
- HostClaw Issues: https://github.com/yourusername/hostclaw.ai/issues
- Email: support@hostclaw.ai