#!/bin/bash

# HostClaw.ai Quick Start Script
# Usage: ./start.sh [dev|prod]

set -e

MODE=${1:-dev}

echo "🐾 Starting HostClaw.ai in $MODE mode..."

if [ "$MODE" = "dev" ]; then
    echo ""
    echo "📦 Installing dependencies..."
    cd api && npm install && cd ..
    
    echo ""
    echo "🐳 Starting services with Docker Compose..."
    docker-compose up -d postgres redis
    
    echo ""
    echo "⏳ Waiting for database..."
    sleep 5
    
    echo ""
    echo "🔄 Running database migrations..."
    cd api && npm run migrate && cd ..
    
    echo ""
    echo "🚀 Starting API server..."
    cd api && npm run dev &
    API_PID=$!
    cd ..
    
    echo ""
    echo "✅ Development environment ready!"
    echo ""
    echo "  📊 API:        http://localhost:3000"
    echo "  🌐 Frontend:   http://localhost:3001"
    echo "  🐘 Postgres:   localhost:5432"
    echo "  ⚡ Redis:      localhost:6379"
    echo ""
    echo "Press Ctrl+C to stop"
    
    trap "kill $API_PID; docker-compose down" EXIT
    wait

elif [ "$MODE" = "prod" ]; then
    echo ""
    echo "🔧 Production deployment..."
    
    # Build and push images
    echo "📦 Building Docker images..."
    cd api && docker build -t hostclaw/api:latest . && cd ..
    docker push hostclaw/api:latest
    
    # Deploy to Kubernetes
    echo ""
    echo "☸️  Deploying to Kubernetes..."
    kubectl apply -f k8s/
    
    echo ""
    echo "✅ Production deployment complete!"
    echo "  API: https://api.hostclaw.ai"
    
else
    echo "Usage: ./start.sh [dev|prod]"
    exit 1
fi