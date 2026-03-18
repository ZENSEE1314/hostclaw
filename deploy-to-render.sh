#!/bin/bash

# Deploy HostClaw to Render
# This script prepares the repository for Render deployment

echo "🚀 Preparing HostClaw for Render deployment..."

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Not a git repository. Please run: git init"
    exit 1
fi

# Check if render.yaml exists
if [ ! -f "render.yaml" ]; then
    echo "❌ render.yaml not found"
    exit 1
fi

# Make sure all changes are committed
echo "📦 Checking for uncommitted changes..."
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  You have uncommitted changes. Committing..."
    git add .
    git commit -m "Prepare for Render deployment"
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Repository ready for Render deployment!"
echo ""
echo "Next steps:"
echo "1. Go to https://dashboard.render.com"
echo "2. Click 'New +' → 'Blueprint'"
echo "3. Connect your GitHub repository"
echo "4. Render will automatically deploy:"
echo "   - Frontend: https://hostclaw-web.onrender.com"
echo "   - API: https://hostclaw-api.onrender.com"
echo "   - Database: PostgreSQL"
echo ""
echo "📚 Full guide: DEPLOY.md"
