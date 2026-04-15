const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

const router = express.Router();
router.use(authenticate);

// Message packages — replaces old credit-based system
const MESSAGE_PACKAGES = {
  msg_1000: {
    name: '1,000 Messages',
    price: 4900,
    messages: 1000,
    type: 'topup',
    mode: 'payment',
    duration: null,
    label: 'Starter'
  },
  msg_5000: {
    name: '5,000 Messages',
    price: 9900,
    messages: 5000,
    type: 'topup',
    mode: 'payment',
    duration: null,
    label: 'Growth',
    featured: true
  },
  msg_unlimited_mo: {
    name: '500K Monthly',
    price: 49900,
    messages: 500000,
    type: 'unlimited',
    mode: 'subscription',
    duration: 30,
    label: 'Pro'
  },
  msg_unlimited_yr: {
    name: '1M Yearly',
    price: 499900,
    messages: 1000000,
    type: 'unlimited',
    mode: 'subscription',
    duration: 365,
    label: 'Enterprise',
    badge: 'Best Value'
  }
};

function getStripe() {
  if (process.env.STRIPE_SECRET_KEY) {
    try { return require('stripe')(process.env.STRIPE_SECRET_KEY); }
    catch (e) { return null; }
  }
  return null;
}

// Get message balance + packages
router.get('/credits', async (req, res, next) => {
  try {
    const balance = await User.getMessageBalance(req.user.userId);
    const user = await User.findById(req.user.userId);
    res.json({
      // Legacy field for backwards compatibility
      credits: parseFloat(user.credits) || 0,
      // New message-based fields
      ...balance,
      my_referral_code: user.my_referral_code || null,
      packages: MESSAGE_PACKAGES
    });
  } catch (error) { next(error); }
});

// Get usage stats
router.get('/usage', async (req, res, next) => {
  try {
    const balance = await User.getMessageBalance(req.user.userId);
    res.json(balance);
  } catch (error) { next(error); }
});

// Get referral stats
router.get('/referral', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const { query } = require('../config/database');

    const referralsResult = await query(
      `SELECT COUNT(*) as count FROM users WHERE referred_by = $1`,
      [req.user.userId]
    );
    const referralCount = parseInt(referralsResult.rows[0]?.count) || 0;

    res.json({
      my_referral_code: user.my_referral_code || null,
      referral_count: referralCount,
      referral_bonus_per_signup: 50,
      referral_purchase_bonus_pct: 10
    });
  } catch (error) { next(error); }
});

// Purchase messages — creates Stripe checkout session
router.post('/credits/checkout', async (req, res, next) => {
  try {
    const { package: packageId } = req.body;
    const pkg = MESSAGE_PACKAGES[packageId];
    if (!pkg) {
      return res.status(400).json({ error: 'Invalid package. Choose: ' + Object.keys(MESSAGE_PACKAGES).join(', ') });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Payment not configured. Please contact support.' });
    }

    const isSubscription = pkg.mode === 'subscription';

    if (isSubscription) {
      // Create or reuse a Stripe Price for subscription
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `ChatsAI ${pkg.name}`,
              description: pkg.duration === 365 ? 'Unlimited AI bot messages for 1 year' : 'Unlimited AI bot messages per month'
            },
            unit_amount: pkg.price,
            recurring: pkg.duration === 365
              ? { interval: 'year' }
              : { interval: 'month' }
          },
          quantity: 1
        }],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/billing.html?purchase=success`,
        cancel_url: `${process.env.FRONTEND_URL}/billing.html?purchase=cancelled`,
        metadata: {
          userId: req.user.userId,
          type: 'messages',
          package: packageId,
          plan_type: 'unlimited',
          duration: pkg.duration.toString()
        }
      });

      return res.json({ url: session.url });
    }

    // One-time payment for message top-ups
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `ChatsAI ${pkg.name}`,
            description: `${pkg.messages.toLocaleString()} AI bot messages`
          },
          unit_amount: pkg.price
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/billing.html?purchase=success`,
      cancel_url: `${process.env.FRONTEND_URL}/billing.html?purchase=cancelled`,
      metadata: {
        userId: req.user.userId,
        type: 'messages',
        package: packageId,
        plan_type: 'paid',
        messages: pkg.messages.toString()
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    next(error);
  }
});

router.get('/invoices', async (req, res) => res.json({ invoices: [] }));

module.exports = router;
