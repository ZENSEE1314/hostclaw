const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const Agent = require('../models/agent');
const { deployAgent, stopAgent, getAgentLogs } = require('../services/deployer-simple');
const { canCreateAgent } = require('../services/billing');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// List user's agents
router.get('/', async (req, res, next) => {
  try {
    const agents = await Agent.findByUser(req.user.userId);
    res.json(agents);
  } catch (error) {
    next(error);
  }
});

// Create new agent
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('description').optional().trim(),
  body('model').optional().isString(),
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

    const agent = await Agent.create({
      userId: req.user.userId,
      name: req.body.name,
      description: req.body.description,
      model: req.body.model,
      channels: req.body.channels || ['web'],
      config: req.body.config || {},
      system_prompt: req.body.system_prompt,
      bot_type: req.body.bot_type,
      business_name: req.body.business_name,
      knowledge_base: req.body.knowledge_base
    });

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
    const agent = await Agent.findById(req.params.id, req.user.userId);
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
    const agent = await Agent.update(req.params.id, req.user.userId, req.body);
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
    
    const deleted = await Agent.delete(req.params.id, req.user.userId);
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
    const agent = await Agent.findById(req.params.id, req.user.userId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Update status to deploying
    await Agent.updateStatus(req.params.id, 'deploying');

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
    await Agent.updateStatus(req.params.id, 'error');
    next(error);
  }
});

// Stop agent
router.post('/:id/stop', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id, req.user.userId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await stopAgent(req.params.id);
    await Agent.updateStatus(req.params.id, 'stopped');

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

// ===== BOOKING ENDPOINTS =====

// Get bookings for an agent
router.get('/:id/bookings', async (req, res, next) => {
  try {
    const bookings = await Agent.getBookings(req.params.id);
    res.json({ bookings });
  } catch (error) { next(error); }
});

// Create a booking
router.post('/:id/bookings', async (req, res, next) => {
  try {
    const { date, time, customer_name, customer_phone } = req.body;
    if (!date || !time) {
      return res.status(400).json({ error: 'Date and time are required' });
    }
    const result = await Agent.addBooking(req.params.id, {
      date, time,
      customer_name: customer_name || 'Guest',
      customer_phone: customer_phone || ''
    });
    if (result?.error === 'slot_taken') {
      return res.status(409).json({ error: 'This time slot is already booked. Please choose another time.' });
    }
    res.status(201).json({ booking: result });
  } catch (error) { next(error); }
});

// Cancel a booking
router.delete('/:id/bookings/:bookingId', async (req, res, next) => {
  try {
    await Agent.cancelBooking(req.params.id, req.params.bookingId);
    res.json({ message: 'Booking cancelled' });
  } catch (error) { next(error); }
});

module.exports = router;
