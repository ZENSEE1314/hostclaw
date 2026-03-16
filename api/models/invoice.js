const { query } = require('../config/database');

class Invoice {
  static async create({ userId, stripeInvoiceId, amount, currency = 'usd', status = 'pending', description }) {
    const result = await query(
      `INSERT INTO invoices (user_id, stripe_invoice_id, amount, currency, status, description) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [userId, stripeInvoiceId, amount, currency, status, description]
    );
    return result.rows[0];
  }

  static async findByUser(userId) {
    const result = await query(
      `SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  static async findByStripeId(stripeInvoiceId) {
    const result = await query(
      'SELECT * FROM invoices WHERE stripe_invoice_id = $1',
      [stripeInvoiceId]
    );
    return result.rows[0];
  }

  static async markPaid(stripeInvoiceId) {
    const result = await query(
      `UPDATE invoices SET status = 'paid', paid_at = CURRENT_TIMESTAMP 
       WHERE stripe_invoice_id = $1 RETURNING *`,
      [stripeInvoiceId]
    );
    return result.rows[0];
  }
}

module.exports = Invoice;