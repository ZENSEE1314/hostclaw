const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Invoice = require('../models/invoice');

const router = express.Router();

// Get Stripe instance - checks env var fresh each time
function getStripe() {
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      return require('stripe')(process.env.STRIPE_SECRET_KEY);
    } catch (e) {
      console.log('⚠️ Stripe not available:', e.message);
      return null;
    }
  }
  return null;
}

router.use(authenticate);

// Get credit balance
router.get('/credits', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json({ credits: user.credits || 0 });
  } catch (error) {
    next(error);
  }
});

// Add credits (Stripe checkout)
router.post('/credits', async (req, res, next) => {
  try {
    const { amount } = req.body;
    
    const stripe = getStripe();
    if (!stripe) {
      console.log('Stripe not configured - STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET' : 'NOT SET');
      return res.status(503).json({ error: 'Stripe not configured. Please contact support.' });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'HostClaw AI Credits',
            description: `$${amount} of AI model credits`
          },
          unit_amount: amount * 100,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/dashboard.html?credits=success`,
      cancel_url: `${process.env.FRONTEND_URL}/billing.html?credits=cancelled`,
      metadata: {
        userId: req.user.userId,
        type: 'credits',
        amount: amount.toString()
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe error:', error);
    next(error);
  }
});

// One-time $500 payment for setup
router.post('/setup-fee', async (req, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      console.log('Stripe not configured - STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET' : 'NOT SET');
      return res.status(503).json({ error: 'Stripe not configured. Please set STRIPE_SECRET_KEY in environment variables.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'HostClaw One-Time Setup Fee',
            description: 'Pay once, unlock all features forever'
          },
          unit_amount: 50000, // $500
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/dashboard.html?paid=success`,
      cancel_url: `${process.env.FRONTEND_URL}/billing.html?paid=cancelled`,
      metadata: {
        userId: req.user.userId,
        type: 'setup_fee'
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe error:', error);
    next(error);
  }
});

// Get invoices
router.get('/invoices', async (req, res, next) => {
  try {
    res.json({ invoices: [] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
