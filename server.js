require('dotenv').config();
const express = require('express');
const app = express();

// ── Validate required env vars on startup ────────────────────────────────────
const REQUIRED_ENV = [
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'ANTHROPIC_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID',
  'STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'BASE_URL'
];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// ── IMPORTANT: Stripe webhook needs raw body ─────────────────────────────────
// Mount Stripe routes BEFORE global body parsers
const stripeRoutes = require('./routes/stripe');
app.use('/stripe', stripeRoutes);

// ── Global middleware (after Stripe) ─────────────────────────────────────────
app.use(express.urlencoded({ extended: false })); // for Twilio
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
const smsRoutes = require('./routes/sms');
app.use('/sms', smsRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'Phew is running', version: '1.0.0' });
});

// ── Health check (for Railway / monitoring) ──────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ healthy: true, uptime: process.uptime() });
});

// ── Cron Jobs ────────────────────────────────────────────────────────────────
const { startThursdayCron } = require('./cron/thursday');
startThursdayCron();

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nPhew server running on port ${PORT}`);
  console.log(`  SMS webhook:    POST /sms/incoming`);
  console.log(`  Stripe webhook: POST /stripe/webhook`);
  console.log(`  Health check:   GET /health`);
  console.log(`  Environment:    ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
