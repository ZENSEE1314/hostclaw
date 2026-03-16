const express = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const {
  createAgent,
  getAgentsByUser,
  getAgentById,
  updateAgent,
  deleteAgent,
  updateAgentStatus
} = require('../models/agent');
const { deployAgent, stopAgent, getAgentLogs } = require('../services/deployer');
const { canCreateAgent } = require('../services/billing');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// List user's agents
router.get('/', async (req, res, next) => {
  try {
    const agents = await getAgentsByUser(req.user.userId);
    res.json(agents);
  } catch (error) {
    next(error);
  }
});

// Create new agent
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('description').optional().trim(),
  body('model').isIn(['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'claude-3.5-sonnet', 'claude-3-opus', 'gemini-pro']),
  body('channels').isArray({ min: 1 }).withMessage('At least one channel required'),
  body('config').optional().isObject()
], async (req, res, next) => {
  try {
    // Check if user can create more agents
    const canCreate = await canCreateAgent(req.user.userId);
    if (!canCreate) {
      return res.status(403).json({
        error: 'Agent limit reached',
        message: 'Upgrade your plan to create more agents'
      });
    }

    const agentData = {
      ...req.body,
      userId: req.user.userId,
      status: 'pending'
    };

    const agent = await createAgent(agentData);

    res.status(201).json({
      message: 'Agent created successfully',
      agent
    });
  } catch (error) {
    next(error);
  }
});

// Get agent details
router.get('/:id', async (req, res, next) => {
  try {
    const agent = await getAgentById(req.params.id, req.user.userId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    next(error);
  }
});

// Update agent
router.patch('/:id', async (req, res, next) => {
  try {
    const agent = await updateAgent(req.params.id, req.user.userId, req.body);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    next(error);
  }
});

// Delete agent
router.delete('/:id', async (req, res, next) => {
  try {
    // Stop agent first if running
    await stopAgent(req.params.id);
    
    const deleted = await deleteAgent(req.params.id, req.user.userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ message: 'Agent deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Deploy agent
router.post('/:id/deploy', async (req, res, next) => {
  try {
    const agent = await getAgentById(req.params.id, req.user.userId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Update status to deploying
    await updateAgentStatus(req.params.id, 'deploying');

    // Trigger deployment
    const deployment = await deployAgent(agent);

    res.json({
      message: 'Deployment started',
      deployment: {
        id: deployment.id,
        status: deployment.status,
        url: deployment.url,
        startedAt: deployment.startedAt
      }
    });
  } catch (error) {
    await updateAgentStatus(req.params.id, 'error');
    next(error);
  }
});

// Stop agent
router.post('/:id/stop', async (req, res, next) => {
  try {
    const agent = await getAgentById(req.params.id, req.user.userId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await stopAgent(req.params.id);
    await updateAgentStatus(req.params.id, 'stopped');

    res.json({ message: 'Agent stopped successfully' });
  } catch (error) {
    next(error);
  }
});

// Get agent logs
router.get('/:id/logs', async (req, res, next) => {
  try {
    const logs = await getAgentLogs(req.params.id);
    res.json({ logs });
  } catch (error) {
    next(error);
  }
});

module.exports = router;