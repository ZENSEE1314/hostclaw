#!/bin/bash

# Render deployment script for HostClaw.ai
# This script runs on Render's build phase

echo "🚀 Starting HostClaw.ai deployment..."

# Install dependencies
echo "📦 Installing dependencies..."
cd api
npm install

# Run database migrations (optional - can also be done manually)
# echo "🔄 Running migrations..."
# npm run migrate

echo "✅ Build complete!"
echo ""
echo "📋 Post-deployment checklist:"
echo "   1. Set environment variables in Render Dashboard:"
echo "      - STRIPE_SECRET_KEY"
echo "      - STRIPE_PUBLISHABLE_KEY"
echo "      - STRIPE_WEBHOOK_SECRET"
echo "      - SMTP_USER"
echo "      - SMTP_PASS"
echo ""
echo "   2. Configure Stripe webhook endpoint:"
echo "      URL: https://hostclaw-api.onrender.com/webhooks/stripe"
echo ""
echo "   3. Run migrations manually:"
echo "      Render Shell → cd api && npm run migrate"