const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const Agent = require('../models/agent');
const User = require('../models/user');
const { query } = require('../config/database');
const EmailService = require('./email');

const execAsync = promisify(exec);

// Deployment configuration
const DEPLOYMENT_CONFIG = {
  namespace: 'hostclaw-agents',
  registry: process.env.DOCKER_REGISTRY || 'hostclaw',
  domain: process.env.AGENT_DOMAIN || 'agents.hostclaw.ai',
  imageTag: process.env.AGENT_IMAGE_TAG || 'latest'
};

class Deployer {
  /**
   * Main deployment orchestrator
   */
  static async deployAgent(agent) {
    const deploymentId = crypto.randomUUID();
    const subdomain = `agent-${agent.id.slice(0, 8)}`;
    const url = `https://${subdomain}.${DEPLOYMENT_CONFIG.domain}`;

    // Create deployment record
    await query(
      'INSERT INTO deployments (id, agent_id, status) VALUES ($1, $2, $3)',
      [deploymentId, agent.id, 'building']
    );

    try {
      // Step 1: Generate agent configuration
      await this.generateAgentConfig(agent, deploymentId);

      // Step 2: Build Docker image
      await this.buildImage(agent, deploymentId);

      // Step 3: Deploy to Kubernetes
      await this.deployToK8s(agent, deploymentId, subdomain);

      // Step 4: Setup ingress and SSL
      await this.setupIngress(agent, deploymentId, subdomain);

      // Step 5: Configure webhooks for channels
      await this.configureChannels(agent, url);

      // Update agent status
      await Agent.updateStatus(agent.id, 'running', {
        url,
        deploymentId,
        containerId: deploymentId
      });

      // Mark deployment complete
      await query(
        'UPDATE deployments SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['completed', deploymentId]
      );

      // Try to send deployment complete email
      try {
        const user = await User.findById(agent.user_id);
        if (user) {
          await EmailService.sendDeploymentComplete(user, {
            ...agent,
            deployment_url: url
          });
        }
      } catch (e) {
        console.log('Deployment email not sent:', e.message);
      }

      return {
        id: deploymentId,
        status: 'completed',
        url,
        startedAt: new Date()
      };

    } catch (error) {
      console.error('Deployment failed:', error);
      
      // Update deployment with error
      await query(
        'UPDATE deployments SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', error.message, deploymentId]
      );

      await Agent.updateStatus(agent.id, 'error');
      throw error;
    }
  }

  /**
   * Generate agent configuration files
   */
  static async generateAgentConfig(agent, deploymentId) {
    const configDir = path.join('/tmp', 'deployments', deploymentId);
    await fs.mkdir(configDir, { recursive: true });

    // Generate OpenClaw config
    const config = {
      name: agent.name,
      description: agent.description,
      model: agent.model,
      channels: agent.channels,
      webhook_url: `https://agent-${agent.id.slice(0, 8)}.${DEPLOYMENT_CONFIG.domain}/webhook`,
      ...agent.config
    };

    // Write config files
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Generate Dockerfile
    const dockerfile = this.generateDockerfile(agent);
    await fs.writeFile(path.join(configDir, 'Dockerfile'), dockerfile);

    // Generate package.json
    const packageJson = {
      name: `hostclaw-agent-${agent.id.slice(0, 8)}`,
      version: '1.0.0',
      dependencies: {
        'openclaw': '^1.0.0',
        'express': '^4.18.0',
        'dotenv': '^16.0.0'
      }
    };
    await fs.writeFile(
      path.join(configDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // Generate entrypoint
    const entrypoint = this.generateEntrypoint(agent);
    await fs.writeFile(path.join(configDir, 'index.js'), entrypoint);

    return configDir;
  }

  /**
   * Build Docker image
   */
  static async buildImage(agent, deploymentId) {
    const configDir = path.join('/tmp', 'deployments', deploymentId);
    const imageName = `${DEPLOYMENT_CONFIG.registry}/agent-${agent.id.slice(0, 8)}:${DEPLOYMENT_CONFIG.imageTag}`;

    const { stdout, stderr } = await execAsync(
      `docker build -t ${imageName} ${configDir}`,
      { timeout: 300000 } // 5 minute timeout
    );

    // Push to registry
    await execAsync(`docker push ${imageName}`);

    return imageName;
  }

  /**
   * Deploy to Kubernetes
   */
  static async deployToK8s(agent, deploymentId, subdomain) {
    const imageName = `${DEPLOYMENT_CONFIG.registry}/agent-${agent.id.slice(0, 8)}:${DEPLOYMENT_CONFIG.imageTag}`;
    
    // Generate K8s deployment manifest
    const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-${agent.id.slice(0, 8)}
  namespace: ${DEPLOYMENT_CONFIG.namespace}
  labels:
    app: agent-${agent.id.slice(0, 8)}
    user-id: ${agent.user_id}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: agent-${agent.id.slice(0, 8)}
  template:
    metadata:
      labels:
        app: agent-${agent.id.slice(0, 8)}
    spec:
      containers:
      - name: agent
        image: ${imageName}
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: AGENT_ID
          value: "${agent.id}"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: agent-${agent.id.slice(0, 8)}-svc
  namespace: ${DEPLOYMENT_CONFIG.namespace}
spec:
  selector:
    app: agent-${agent.id.slice(0, 8)}
  ports:
  - port: 80
    targetPort: 3000
`;

    // Write and apply manifest
    const manifestPath = path.join('/tmp', 'deployments', `${deploymentId}.yaml`);
    await fs.writeFile(manifestPath, manifest);
    
    await execAsync(`kubectl apply -f ${manifestPath}`);

    // Wait for deployment to be ready
    await execAsync(
      `kubectl wait --for=condition=available --timeout=120s deployment/agent-${agent.id.slice(0, 8)} -n ${DEPLOYMENT_CONFIG.namespace}`
    );
  }

  /**
   * Setup ingress with SSL
   */
  static async setupIngress(agent, deploymentId, subdomain) {
    const ingressManifest = `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: agent-${agent.id.slice(0, 8)}-ingress
  namespace: ${DEPLOYMENT_CONFIG.namespace}
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  tls:
  - hosts:
    - ${subdomain}.${DEPLOYMENT_CONFIG.domain}
    secretName: agent-${agent.id.slice(0, 8)}-tls
  rules:
  - host: ${subdomain}.${DEPLOYMENT_CONFIG.domain}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: agent-${agent.id.slice(0, 8)}-svc
            port:
              number: 80
`;

    const ingressPath = path.join('/tmp', 'deployments', `${deploymentId}-ingress.yaml`);
    await fs.writeFile(ingressPath, ingressManifest);
    await execAsync(`kubectl apply -f ${ingressPath}`);
  }

  /**
   * Configure channel webhooks
   */
  static async configureChannels(agent, webhookUrl) {
    const configs = {
      telegram: async () => {
        if (agent.config.telegramBotToken) {
          // Set webhook via Telegram API
          const axios = require('axios');
          await axios.post(
            `https://api.telegram.org/bot${agent.config.telegramBotToken}/setWebhook`,
            { url: `${webhookUrl}/telegram` }
          );
        }
      },
      discord: async () => {
        // Discord bot webhook handled via gateway intents
        console.log('Discord bot configured:', webhookUrl);
      },
      slack: async () => {
        // Slack webhook URL configured in agent
        console.log('Slack webhook configured:', webhookUrl);
      },
      whatsapp: async () => {
        // WhatsApp Business API webhook
        console.log('WhatsApp webhook configured:', webhookUrl);
      }
    };

    for (const channel of agent.channels) {
      if (configs[channel]) {
        await configs[channel]();
      }
    }
  }

  /**
   * Stop and remove agent deployment
   */
  static async stopAgent(agentId) {
    const agent = await Agent.findById(agentId);
    if (!agent) return;

    try {
      // Delete Kubernetes resources
      await execAsync(
        `kubectl delete deployment agent-${agentId.slice(0, 8)} -n ${DEPLOYMENT_CONFIG.namespace} --ignore-not-found`
      );
      await execAsync(
        `kubectl delete service agent-${agentId.slice(0, 8)}-svc -n ${DEPLOYMENT_CONFIG.namespace} --ignore-not-found`
      );
      await execAsync(
        `kubectl delete ingress agent-${agentId.slice(0, 8)}-ingress -n ${DEPLOYMENT_CONFIG.namespace} --ignore-not-found`
      );

      // Clean up Docker images
      const imageName = `${DEPLOYMENT_CONFIG.registry}/agent-${agentId.slice(0, 8)}`;
      await execAsync(`docker rmi ${imageName}:${DEPLOYMENT_CONFIG.imageTag} --force`).catch(() => {});

      await Agent.updateStatus(agentId, 'stopped');
    } catch (error) {
      console.error('Error stopping agent:', error);
      throw error;
    }
  }

  /**
   * Get deployment logs
   */
  static async getAgentLogs(agentId) {
    try {
      const { stdout } = await execAsync(
        `kubectl logs deployment/agent-${agentId.slice(0, 8)} -n ${DEPLOYMENT_CONFIG.namespace} --tail=100`
      );
      return stdout;
    } catch (error) {
      return 'No logs available. Agent may not be running.';
    }
  }

  /**
   * Generate Dockerfile
   */
  static generateDockerfile(agent) {
    return `FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

USER node

CMD ["node", "index.js"]
`;
  }

  /**
   * Generate agent entrypoint
   */
  static generateEntrypoint(agent) {
    return `const express = require('express');
const app = express();

app.use(express.json());

// Health checks
app.get('/health', (req, res) => res.json({ status: 'healthy', agentId: '${agent.id}' }));
app.get('/ready', (req, res) => res.json({ ready: true }));

// Webhook endpoint
app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);
  // Process webhook and respond
  res.json({ status: 'ok' });
});

// Telegram webhook
app.post('/telegram', (req, res) => {
  const { message } = req.body;
  console.log('Telegram message:', message);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Agent ${agent.name} running on port', PORT);
});
`;
  }
}

module.exports = Deployer;