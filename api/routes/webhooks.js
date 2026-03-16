const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user');
const Invoice = require('../models/invoice');

const router = express.Router();

// Stripe webhook endpoint (no auth required - uses signature verification)
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handleInvoicePaid(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handleInvoiceFailed(invoice);
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object;
        await handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCancelled(subscription);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

async function handleCheckoutCompleted(session) {
  const { userId, type, amount, plan } = session.metadata;

  if (type === 'credits') {
    // Add credits to user account
    await User.updateCredits(userId, parseFloat(amount));
    console.log(`✅ Added $${amount} credits to user ${userId}`);
  } else if (type === 'subscription') {
    // Update user plan
    await User.updateStripeInfo(userId, {
      customerId: session.customer,
      subscriptionId: session.subscription
    });
    await User.updatePlan(userId, plan);
    console.log(`✅ User ${userId} subscribed to ${plan} plan`);
  }
}

async function handleInvoicePaid(invoice) {
  // Mark invoice as paid in database
  const dbInvoice = await Invoice.findByStripeId(invoice.id);
  if (dbInvoice) {
    await Invoice.markPaid(invoice.id);
  }
  console.log(`✅ Invoice ${invoice.id} paid`);
}

async function handleInvoiceFailed(invoice) {
  console.log(`❌ Invoice ${invoice.id} payment failed`);
  // Could notify user, downgrade plan, etc.
}

async function handleSubscriptionCreated(subscription) {
  console.log(`✅ Subscription ${subscription.id} created`);
}

async function handleSubscriptionCancelled(subscription) {
  // Downgrade user to free plan
  const customer = await stripe.customers.retrieve(subscription.customer);
  // Find user by stripe_customer_id and downgrade
  console.log(`⚠️ Subscription ${subscription.id} cancelled`);
}

// GitHub webhook for auto-deployment
router.post('/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'push') {
    // Handle code push - could trigger agent rebuilds
    console.log('GitHub push received:', payload.repository.full_name);
  }

  res.json({ received: true });
});

module.exports = router;