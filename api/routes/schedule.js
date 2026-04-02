const express = require('express');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const crypto = require('crypto');

const router = express.Router();
router.use(authenticate);

// Get all scheduled tasks (for calendar view)
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM scheduled_tasks WHERE user_id = $1 ORDER BY scheduled_at ASC`,
      [req.user.userId]
    );
    // Also get bookings from all agents
    const bookings = await query(
      `SELECT a.id as agent_id, a.name as agent_name, a.bookings
       FROM agents a WHERE a.user_id = $1 AND a.bookings IS NOT NULL AND a.bookings != '[]'`,
      [req.user.userId]
    );

    const allBookings = [];
    for (const row of bookings.rows) {
      const bks = typeof row.bookings === 'string' ? JSON.parse(row.bookings) : (row.bookings || []);
      for (const b of bks) {
        if (b.status === 'confirmed') {
          allBookings.push({ ...b, agent_name: row.agent_name, agent_id: row.agent_id, type: 'booking' });
        }
      }
    }

    res.json({
      tasks: result.rows,
      bookings: allBookings
    });
  } catch (error) { next(error); }
});

// Create scheduled task (broadcast, reminder, etc.)
router.post('/', async (req, res, next) => {
  try {
    const { type, title, message, image_url, target_contacts, target_group, scheduled_at, repeat_type } = req.body;
    if (!type || !scheduled_at) return res.status(400).json({ error: 'Type and scheduled_at required' });

    const id = crypto.randomUUID();
    await query(
      `INSERT INTO scheduled_tasks (id, user_id, type, title, message, image_url, target_contacts, target_group, scheduled_at, repeat_type, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',CURRENT_TIMESTAMP)`,
      [id, req.user.userId, type, title || '', message || '', image_url || '',
       JSON.stringify(target_contacts || []), target_group || '', scheduled_at, repeat_type || 'once']
    );
    res.status(201).json({ id, scheduled: true });
  } catch (error) { next(error); }
});

// Update task
router.patch('/:id', async (req, res, next) => {
  try {
    const { title, message, image_url, scheduled_at, status } = req.body;
    const sets = [];
    const vals = [];
    let i = 1;
    if (title !== undefined) { sets.push(`title=$${i++}`); vals.push(title); }
    if (message !== undefined) { sets.push(`message=$${i++}`); vals.push(message); }
    if (image_url !== undefined) { sets.push(`image_url=$${i++}`); vals.push(image_url); }
    if (scheduled_at !== undefined) { sets.push(`scheduled_at=$${i++}`); vals.push(scheduled_at); }
    if (status !== undefined) { sets.push(`status=$${i++}`); vals.push(status); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.params.id, req.user.userId);
    await query(`UPDATE scheduled_tasks SET ${sets.join(',')} WHERE id=$${i} AND user_id=$${i + 1}`, vals);
    res.json({ updated: true });
  } catch (error) { next(error); }
});

// Delete task
router.delete('/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM scheduled_tasks WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

module.exports = router;
