const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Agent = require('../models/agent');
const Chat = require('../models/chat');
const { query } = require('../config/database');
const crypto = require('crypto');

const router = express.Router();
router.use(authenticate);

// ===== SALES BOOK (CRM) =====

// Get all sales leads
router.get('/leads', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM sales_leads WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.userId]
    );
    res.json({ leads: result.rows });
  } catch (error) { next(error); }
});

// Get single lead with full history
router.get('/leads/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM sales_leads WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Lead not found' });

    // Get conversation history for this customer
    const lead = result.rows[0];
    let chatHistory = [];
    if (lead.session_id) {
      chatHistory = await Chat.getSessionHistory(req.user.userId, lead.session_id, 50);
    }

    res.json({ lead: result.rows[0], chatHistory });
  } catch (error) { next(error); }
});

// Create/update a lead
router.post('/leads', async (req, res, next) => {
  try {
    const { customer_name, customer_phone, customer_email, platform, platform_id,
            session_id, product_interest, amount, status, notes, tags } = req.body;

    const id = crypto.randomUUID();
    const result = await query(
      `INSERT INTO sales_leads (id, user_id, customer_name, customer_phone, customer_email,
       platform, platform_id, session_id, product_interest, amount, status, notes, tags, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, req.user.userId, customer_name || 'Unknown', customer_phone || '',
       customer_email || '', platform || '', platform_id || '', session_id || '',
       product_interest || '', amount || 0, status || 'enquiry',
       notes || '', JSON.stringify(tags || [])]
    );
    res.status(201).json({ lead: result.rows[0] });
  } catch (error) { next(error); }
});

// Update lead
router.patch('/leads/:id', async (req, res, next) => {
  try {
    const allowed = ['customer_name', 'customer_phone', 'customer_email',
                     'product_interest', 'amount', 'status', 'notes', 'tags'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = $${i}`);
        vals.push(k === 'tags' ? JSON.stringify(v) : v);
        i++;
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No valid fields' });

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    vals.push(req.params.id, req.user.userId);

    const result = await query(
      `UPDATE sales_leads SET ${sets.join(', ')} WHERE id = $${i} AND user_id = $${i + 1} RETURNING *`,
      vals
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead: result.rows[0] });
  } catch (error) { next(error); }
});

// Delete lead
router.delete('/leads/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM sales_leads WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]);
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// Get sales stats
router.get('/stats', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE status = 'enquiry') as enquiries,
        COUNT(*) FILTER (WHERE status = 'purchased') as converted,
        COUNT(*) FILTER (WHERE status = 'follow_up') as follow_ups,
        COUNT(*) FILTER (WHERE status = 'lost') as lost,
        COALESCE(SUM(amount) FILTER (WHERE status = 'purchased'), 0) as total_revenue
      FROM sales_leads WHERE user_id = $1
    `, [req.user.userId]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

// ===== FOLLOW-UP SEQUENCES =====

// Get follow-up config for an agent
router.get('/followups/:agentId', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.agentId, req.user.userId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const config = agent.config || {};
    res.json({
      enabled: config.followup_enabled || false,
      sequences: config.followup_sequences || [
        { delay_minutes: 60, discount_percent: 20, message_template: 'Special offer just for you! Get {discount}% off {product} for the next hour only.' },
        { delay_minutes: 120, discount_percent: 50, message_template: 'Last chance! {discount}% off {product} — this offer expires soon!' }
      ]
    });
  } catch (error) { next(error); }
});

// Save follow-up config
router.put('/followups/:agentId', async (req, res, next) => {
  try {
    const { enabled, sequences } = req.body;
    const agent = await Agent.findById(req.params.agentId, req.user.userId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const config = agent.config || {};
    config.followup_enabled = !!enabled;
    config.followup_sequences = (sequences || []).map((s, idx) => ({
      id: s.id || idx,
      delay_minutes: parseInt(s.delay_minutes) || 60,
      discount_percent: parseInt(s.discount_percent) || 0,
      message_template: s.message_template || '',
      target: s.target || 'no_purchase' // no_purchase | first_buyer | all
    }));

    await Agent.update(agent.id, req.user.userId, { config });
    res.json({ saved: true, config });
  } catch (error) { next(error); }
});

// Get pending follow-ups (for the scheduler)
router.get('/pending-followups', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM sales_followups
       WHERE user_id = $1 AND status = 'pending' AND send_at <= CURRENT_TIMESTAMP
       ORDER BY send_at ASC LIMIT 50`,
      [req.user.userId]
    );
    res.json({ followups: result.rows });
  } catch (error) { next(error); }
});

// Schedule a follow-up
router.post('/schedule-followup', async (req, res, next) => {
  try {
    const { lead_id, session_id, platform, platform_id, message, send_at, sequence_index } = req.body;
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO sales_followups (id, user_id, lead_id, session_id, platform, platform_id, message, send_at, sequence_index, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',CURRENT_TIMESTAMP)`,
      [id, req.user.userId, lead_id || '', session_id, platform, platform_id, message,
       send_at, sequence_index || 0]
    );
    res.json({ scheduled: true, id });
  } catch (error) { next(error); }
});

module.exports = router;
