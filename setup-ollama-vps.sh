#!/bin/bash
# Install Ollama on the VPS and pull Gemma4 cloud model
# Run: curl -sL https://chatsai.app/setup-ollama-vps.sh | bash

set -e

echo "========================================="
echo "  Installing Ollama + Gemma4 on VPS"
echo "========================================="

# 1. Install Ollama
echo ">> Installing Ollama..."
curl -fsSL https://ollama.com/install.sh | sh
echo "Ollama installed"

# 2. Start Ollama service
echo ">> Starting Ollama..."
systemctl enable ollama
systemctl start ollama
sleep 3

# 3. Set Ollama to listen on all interfaces
echo ">> Configuring Ollama for external access..."
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF
systemctl daemon-reload
systemctl restart ollama
sleep 3

# 4. Pull Gemma4 cloud model
echo ">> Pulling gemma4:31b-cloud model..."
ollama pull gemma4:31b-cloud

# 5. Open firewall for Ollama
echo ">> Opening firewall port 11434..."
ufw allow 11434/tcp

echo ""
echo "========================================="
echo "  Ollama Setup Complete!"
echo "========================================="
echo ""
echo "  Ollama URL: http://$(curl -s ifconfig.me):11434"
echo "  Model: gemma4:31b-cloud"
echo ""
echo "  Test: curl http://$(curl -s ifconfig.me):11434/api/tags"
echo ""
