const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getUser, updateUser } = require('../services/airtable');
const { sendSMS } = require('../services/twilio');

// Stripe webhook — MUST use express.raw() for signature verification
// This route is mounted BEFORE global body parsers in server.js
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle subscription activated
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const phone = session.metadata?.phone;

    if (phone) {
      const user = await getUser(phone);
      if (user) {
        await updateUser(user.id, {
          is_subscribed: true,
          state: 'ACTIVE',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription
        });

        await sendSMS(phone,
          `You're in! Welcome to Phew. Unlimited recommendations, plus I'll text you every Thursday with weekend ideas.\n\nSo — what are we looking for this weekend?`
        );
      }
    }
  }

  // Handle subscription cancelled
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    // Find user by stripe customer id — search Airtable
    // Note: For production scale, consider indexing this field
    console.log(`Subscription cancelled for Stripe customer: ${customerId}`);
  }

  res.json({ received: true });
});

// Success page after payment
router.get('/subscribed', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>You're in! - Phew</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#f9f5f0;max-width:500px;margin:0 auto">
        <h1 style="font-size:48px;margin-bottom:10px">&#127881;</h1>
        <h2 style="color:#1a1a1a">You're subscribed to Phew!</h2>
        <p style="color:#666;line-height:1.6">Head back to your texts — I'll be in touch every Thursday with weekend ideas for your kids.</p>
      </body>
    </html>
  `);
});

router.get('/cancelled', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Phew</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#f9f5f0;max-width:500px;margin:0 auto">
        <h2 style="color:#1a1a1a">No worries!</h2>
        <p style="color:#666;line-height:1.6">Text us anytime if you change your mind. Your profile is saved and ready to go.</p>
      </body>
    </html>
  `);
});

module.exports = router;
