const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticate } = require('../middleware/auth');
const { getUserCredits, addCredits, createSubscription, cancelSubscription } = require('../models/user');
const { createInvoice, getUserInvoices } = require('../models/invoice');

const router = express.Router();

router.use(authenticate);

// Get credit balance
router.get('/credits', async (req, res, next) => {
  try {
    const credits = await getUserCredits(req.user.userId);
    res.json({ credits });
  } catch (error) {
    next(error);
  }
});

// Add credits (Stripe checkout)
router.post('/credits', async (req, res, next) => {
  try {
    const { amount } = req.body; // Amount in dollars

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
          unit_amount: amount * 100, // Convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/dashboard?credits=success`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?credits=cancelled`,
      metadata: {
        userId: req.user.userId,
        type: 'credits',
        amount: amount.toString()
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

// Subscribe to plan
router.post('/subscribe', async (req, res, next) => {
  try {
    const { plan } = req.body; // 'starter', 'pro', 'enterprise'

    const priceMap = {
      starter: process.env.STRIPE_PRICE_STARTER,
      pro: process.env.STRIPE_PRICE_PRO,
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE
    };

    const priceId = priceMap[plan];
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Create Stripe checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard?subscription=success`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?subscription=cancelled`,
      metadata: {
        userId: req.user.userId,
        type: 'subscription',
        plan: plan
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

// Cancel subscription
router.post('/cancel', async (req, res, next) => {
  try {
    await cancelSubscription(req.user.userId);
    res.json({ message: 'Subscription cancelled successfully' });
  } catch (error) {
    next(error);
  }
});

// Get invoices
router.get('/invoices', async (req, res, next) => {
  try {
    const invoices = await getUserInvoices(req.user.userId);
    res.json(invoices);
  } catch (error) {
    next(error);
  }
});

// Setup payment gateway for user's agents
router.post('/gateway', async (req, res, next) => {
  try {
    const { type, apiKey } = req.body;

    if (type === 'stripe') {
      // Verify the API key
      try {
        const testStripe = require('stripe')(apiKey);
        await testStripe.account.retrieve();
      } catch (err) {
        return res.status(400).json({ error: 'Invalid Stripe API key' });
      }

      // Store encrypted API key
      await updateUserGateway(req.user.userId, {
        type: 'stripe',
        apiKey: encrypt(apiKey)
      });

      res.json({ message: 'Stripe connected successfully' });
    } else if (type === 'paypal') {
      // PayPal integration
      res.json({ message: 'PayPal integration coming soon' });
    } else {
      res.status(400).json({ error: 'Unsupported gateway type' });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;