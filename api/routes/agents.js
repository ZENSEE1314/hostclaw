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
    const { date, time, customer_name, customer_phone, customer_jid, service, session_id } = req.body;
    if (!date || !time) {
      return res.status(400).json({ error: 'Date and time are required' });
    }
    const result = await Agent.addBooking(req.params.id, {
      date, time,
      customer_name: customer_name || 'Guest',
      customer_phone: customer_phone || '',
      customer_jid: customer_jid || '',  // WhatsApp JID for reminders
      session_id: session_id || '',      // chat session if created from conversation
      service: service || ''
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

// Generate an "About / What You Do" paragraph from just business name + industry.
router.post('/:id/about/generate', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id, req.user.userId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { name = '', industry = '' } = req.body || {};
    if (!name.trim() && !industry.trim()) {
      return res.status(400).json({ error: 'Provide at least a business name or industry.' });
    }

    const { generateAIResponse } = require('../services/ai');
    const User = require('../models/user');
    const user = await User.findById(req.user.userId);
    const providers = typeof user.api_providers === 'string' ? JSON.parse(user.api_providers || '{}') : (user.api_providers || {});
    const defProv = user.default_provider || 'ollama';
    const providerConfig = providers[defProv] || providers[Object.keys(providers)[0]] || { model: 'gemma4:31b-cloud' };

    const instruction = `Write a short, friendly "About Us" paragraph (3-5 sentences, max 500 characters) for a business. Speak to customers in first-person plural ("we", "our"). Describe what the business does, who it serves, and what makes it appealing. Do NOT use quotes, markdown, headers, or bullet points. Plain prose only.\n\nBusiness name: ${name || '(not provided)'}\nIndustry / offerings: ${industry || '(not provided)'}`;

    const aiRes = await generateAIResponse({
      message: instruction,
      provider: defProv,
      providerConfig,
      skills: [],
      chatHistory: [],
      agent: null
    });

    const about = (aiRes.content || '').trim().replace(/^["']|["']$/g, '').slice(0, 800);
    res.json({ about, model: aiRes.model });
  } catch (error) {
    next(error);
  }
});

// Generate a short agent description from the business profile.
router.post('/:id/description/generate', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id, req.user.userId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const kb = Array.isArray(agent.knowledge_base)
      ? agent.knowledge_base
      : (typeof agent.knowledge_base === 'string' ? JSON.parse(agent.knowledge_base || '[]') : []);
    const biz = kb.find(e => e.type === 'business_info') || {};

    const profileParts = [
      biz.title ? `Company: ${biz.title}` : '',
      biz.industry ? `Industry: ${biz.industry}` : '',
      biz.description ? `About: ${biz.description}` : '',
      biz.hours ? `Hours: ${biz.hours}` : '',
      biz.address ? `Address: ${biz.address}` : '',
      biz.website ? `Website: ${biz.website}` : ''
    ].filter(Boolean);

    if (!profileParts.length) {
      return res.status(400).json({ error: 'Fill in the Business Info first (name, industry, about).' });
    }

    const { generateAIResponse } = require('../services/ai');
    const User = require('../models/user');
    const user = await User.findById(req.user.userId);
    const providers = typeof user.api_providers === 'string' ? JSON.parse(user.api_providers || '{}') : (user.api_providers || {});
    const defProv = user.default_provider || 'ollama';
    const providerConfig = providers[defProv] || providers[Object.keys(providers)[0]] || { model: 'gemma4:31b-cloud' };

    const instruction = `Write ONE short internal description (1-2 sentences, max 200 chars) of what this AI agent does, based on the business profile. Do not repeat the company name. Do not use quotes or markdown. Plain text only.\n\nPROFILE:\n${profileParts.join('\n')}`;

    const aiRes = await generateAIResponse({
      message: instruction,
      provider: defProv,
      providerConfig,
      skills: [],
      chatHistory: [],
      agent: null
    });

    const desc = (aiRes.content || '').trim().replace(/^["']|["']$/g, '').slice(0, 300);
    res.json({ description: desc, model: aiRes.model });
  } catch (error) {
    next(error);
  }
});

// Generate FAQ suggestions from the agent's business profile using the user's default AI provider.
// POST body (optional): { count: number, focus: string }
router.post('/:id/faqs/generate', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id, req.user.userId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { count = 6, focus = '' } = req.body || {};
    const kb = Array.isArray(agent.knowledge_base)
      ? agent.knowledge_base
      : (typeof agent.knowledge_base === 'string' ? JSON.parse(agent.knowledge_base || '[]') : []);
    const biz = kb.find(e => e.type === 'business_info') || {};
    const products = kb.filter(e => e.type === 'product');

    const profileParts = [
      biz.title ? `Company: ${biz.title}` : '',
      biz.industry ? `Industry: ${biz.industry}` : '',
      biz.description ? `About: ${biz.description}` : '',
      biz.hours ? `Hours: ${biz.hours}` : '',
      biz.address ? `Address: ${biz.address}` : '',
      biz.phone ? `Phone: ${biz.phone}` : '',
      biz.website ? `Website: ${biz.website}` : '',
      agent.description ? `Agent description: ${agent.description}` : '',
      agent.system_prompt ? `Bot persona: ${agent.system_prompt}` : ''
    ].filter(Boolean);

    if (products.length) {
      profileParts.push('Products/Services: ' + products.map(p => p.title).join(', '));
    }
    const profile = profileParts.join('\n');

    if (!profile.trim()) {
      return res.status(400).json({ error: 'Fill in the business info first (name, description, etc.) before generating FAQs.' });
    }

    const { generateAIResponse } = require('../services/ai');
    const User = require('../models/user');
    const user = await User.findById(req.user.userId);
    const providers = typeof user.api_providers === 'string' ? JSON.parse(user.api_providers || '{}') : (user.api_providers || {});
    const defProv = user.default_provider || 'ollama';
    const providerConfig = providers[defProv] || providers[Object.keys(providers)[0]] || { model: 'gemma4:31b-cloud' };

    const instruction = `Based on this business profile, generate exactly ${count} realistic FAQs that customers commonly ask. ${focus ? 'Focus area: ' + focus + '. ' : ''}Return ONLY a JSON array, no prose, no markdown fences. Each item must have this shape: {"question":"...", "answer":"...", "keywords":"comma,separated,terms"}. Answers should be concise (1-3 sentences) and factual to the profile.\n\nPROFILE:\n${profile}`;

    const aiRes = await generateAIResponse({
      message: instruction,
      provider: defProv,
      providerConfig,
      skills: [],
      chatHistory: [],
      agent: null
    });

    // Extract JSON array from the model's response (tolerate markdown fences)
    let text = (aiRes.content || '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd === -1) {
      return res.status(502).json({ error: 'AI returned no valid FAQ list', raw: text.slice(0, 300) });
    }

    let faqs;
    try {
      faqs = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    } catch (e) {
      return res.status(502).json({ error: 'Failed to parse AI output', raw: text.slice(0, 300) });
    }

    const cleaned = (Array.isArray(faqs) ? faqs : [])
      .filter(f => f && f.question && f.answer)
      .map(f => ({
        question: String(f.question).trim(),
        answer: String(f.answer).trim(),
        keywords: String(f.keywords || '').trim()
      }));

    res.json({ faqs: cleaned, model: aiRes.model });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
