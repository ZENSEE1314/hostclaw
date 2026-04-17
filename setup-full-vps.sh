#!/bin/bash
# Full ChatsAI deployment to VPS
# Run: curl -sL https://chatsai.app/setup-full-vps.sh | bash
# Or after migration: ssh root@IP then curl -sL ...

set -e

echo "========================================="
echo "  ChatsAI Full VPS Deployment"
echo "========================================="

# 1. Install system packages
echo ">> Installing system packages..."
apt-get update -y
apt-get install -y curl git nginx postgresql postgresql-contrib ufw

# 2. Install Node.js 22
echo ">> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "Node.js $(node -v)"

# 3. Install PM2
echo ">> Installing PM2..."
npm install -g pm2

# 4. Set up PostgreSQL
echo ">> Setting up PostgreSQL..."
systemctl enable postgresql
systemctl start postgresql
sudo -u postgres psql -c "CREATE DATABASE chatsai;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER chatsai WITH PASSWORD 'ChatsAI_DB_2026';" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE chatsai TO chatsai;" 2>/dev/null || true
sudo -u postgres psql -d chatsai -c "GRANT ALL ON SCHEMA public TO chatsai;" 2>/dev/null || true

# 5. Clone repo
echo ">> Cloning repo..."
mkdir -p /opt/chatsai
cd /opt/chatsai
if [ -d "hostclaw" ]; then
  cd hostclaw
  git pull
else
  git clone https://github.com/ZENSEE1314/hostclaw.git
  cd hostclaw
fi

# 6. Install API dependencies
echo ">> Installing API dependencies..."
cd /opt/chatsai/hostclaw/api
npm install --omit=dev

# 7. Create .env file
echo ">> Creating .env..."
cat > /opt/chatsai/hostclaw/api/.env << 'ENVEOF'
NODE_ENV=production
PORT=10000
DATABASE_URL=postgresql://chatsai:ChatsAI_DB_2026@localhost:5432/chatsai
JWT_SECRET=chatsai_jwt_secret_2026_production_key_change_me
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://chatsai.app
API_URL=https://chatsai.app
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:31b-cloud
HOSTCLAW_DEFAULT_PROVIDER=ollama
WA_VPS_URL=http://localhost:3001
WHATSAPP_VERIFY_TOKEN=chatsai_webhook_verify_2026
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=zensee1314@gmail.com
SMTP_PASS=epgy pako lyis ajvu
SMTP_FROM="ChatsAI" <support@chatsai.app>
ENVEOF

# 8. Run database migrations
echo ">> Running migrations..."
cd /opt/chatsai/hostclaw/api
node config/migrate.js || echo "Migration may have partial results"

# 9. Start API with PM2
echo ">> Starting API..."
pm2 delete chatsai-api 2>/dev/null || true
cd /opt/chatsai/hostclaw/api
pm2 start server.js --name chatsai-api
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# 10. Set up Nginx to serve frontend + proxy API
echo ">> Setting up Nginx..."
cat > /etc/nginx/sites-available/chatsai << 'NGINXEOF'
server {
    listen 80;
    server_name chatsai.app www.chatsai.app;

    client_max_body_size 50M;

    # Serve frontend static files
    root /opt/chatsai/hostclaw;
    index index.html;

    # API routes -> Node.js server
    location /api/ {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /webhooks/ {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /health {
        proxy_pass http://localhost:10000;
    }

    # Frontend — try file, then fall through
    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/chatsai /etc/nginx/sites-enabled/chatsai
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# 11. Firewall
echo ">> Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3001/tcp
ufw allow 11434/tcp
ufw --force enable

echo ""
echo "========================================="
echo "  Deployment Complete!"
echo "========================================="
echo ""
echo "  IP: $(curl -s ifconfig.me)"
echo "  API: http://$(curl -s ifconfig.me)/health"
echo ""
echo "  Next steps:"
echo "  1. Point chatsai.app DNS A record to $(curl -s ifconfig.me) in Cloudflare"
echo "  2. Once DNS propagates, install SSL: certbot --nginx -d chatsai.app -d www.chatsai.app"
echo ""
echo "  PM2 commands:"
echo "    pm2 status"
echo "    pm2 logs chatsai-api"
echo "    pm2 restart chatsai-api"
