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

// ── Privacy Policy ───────────────────────────────────────────────────────────
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Phew</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #333; padding: 40px 20px; max-width: 800px; margin: 0 auto; background: #fafafa; }
    h1 { font-size: 2em; margin-bottom: 8px; color: #1a1a1a; }
    .updated { color: #888; font-size: 0.9em; margin-bottom: 32px; }
    h2 { font-size: 1.3em; margin-top: 32px; margin-bottom: 12px; color: #1a1a1a; }
    p { margin-bottom: 16px; }
    ul { margin: 0 0 16px 24px; }
    li { margin-bottom: 8px; }
    a { color: #2563eb; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #ddd; color: #888; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: March 8, 2026</p>

  <p>Phew ("we", "us", or "our") provides an SMS-based service that helps parents find weekend activities for their children. This Privacy Policy explains how we collect, use, and protect your information.</p>

  <h2>Information We Collect</h2>
  <p>When you use Phew, we collect the following information that you provide via text message:</p>
  <ul>
    <li><strong>Phone number</strong> — automatically captured when you text us</li>
    <li><strong>Zip code</strong> — to find activities near you</li>
    <li><strong>Number and ages of children</strong> — to recommend age-appropriate activities</li>
    <li><strong>Activity preferences</strong> — to personalize recommendations</li>
  </ul>

  <h2>How We Use Your Information</h2>
  <p>We use your information solely to:</p>
  <ul>
    <li>Provide personalized activity recommendations for your family</li>
    <li>Send you weekly activity suggestions via SMS</li>
    <li>Process your subscription payment (if applicable)</li>
    <li>Improve our service and recommendations</li>
  </ul>

  <h2>Data Storage and Security</h2>
  <p>Your data is stored securely using industry-standard encryption and access controls. We use Airtable for data storage, Twilio for SMS messaging, Stripe for payment processing, and Anthropic's Claude AI for generating recommendations. Each of these providers maintains their own security and privacy practices.</p>

  <h2>Data Sharing</h2>
  <p>We do not sell, rent, or share your personal information with third parties for marketing purposes. We only share data with the service providers listed above as necessary to operate Phew.</p>

  <h2>Data Retention</h2>
  <p>We retain your information for as long as your account is active. If you unsubscribe by texting STOP, we will retain your data for up to 30 days before deletion, unless required by law to retain it longer.</p>

  <h2>Your Rights</h2>
  <p>You have the right to:</p>
  <ul>
    <li>Request access to your personal data</li>
    <li>Request correction or deletion of your data</li>
    <li>Opt out of SMS messages at any time by texting STOP</li>
    <li>Request a copy of your data by texting us</li>
  </ul>

  <h2>Children's Privacy</h2>
  <p>Phew is a service for parents and guardians. We do not knowingly collect information directly from children under 13. The information we collect about children (ages and number) is provided by their parent or guardian.</p>

  <h2>Changes to This Policy</h2>
  <p>We may update this Privacy Policy from time to time. We will notify you of any material changes by sending a text message to your registered phone number.</p>

  <h2>Contact Us</h2>
  <p>If you have any questions about this Privacy Policy, please text us at our Phew number or email us at odedpo@gmail.com.</p>

  <div class="footer">
    <p>&copy; 2026 Phew. All rights reserved.</p>
  </div>
</body>
</html>`);
});

// ── Terms of Service ─────────────────────────────────────────────────────────
app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - Phew</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #333; padding: 40px 20px; max-width: 800px; margin: 0 auto; background: #fafafa; }
    h1 { font-size: 2em; margin-bottom: 8px; color: #1a1a1a; }
    .updated { color: #888; font-size: 0.9em; margin-bottom: 32px; }
    h2 { font-size: 1.3em; margin-top: 32px; margin-bottom: 12px; color: #1a1a1a; }
    p { margin-bottom: 16px; }
    ul { margin: 0 0 16px 24px; }
    li { margin-bottom: 8px; }
    a { color: #2563eb; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #ddd; color: #888; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: March 8, 2026</p>

  <p>Welcome to Phew! By texting our phone number and using our service, you agree to the following terms.</p>

  <h2>1. Service Description</h2>
  <p>Phew is an SMS-based service that provides personalized weekend activity recommendations for families with children. We use AI technology to suggest local activities based on your location, children's ages, and preferences.</p>

  <h2>2. Eligibility</h2>
  <p>You must be at least 18 years old and a parent or legal guardian to use Phew. By using the service, you represent that you meet these requirements.</p>

  <h2>3. Opting In and Out</h2>
  <p>You opt in to Phew by sending your first text message to our phone number. You may opt out at any time by texting STOP. After opting out, you will receive one final confirmation message and no further messages will be sent.</p>

  <h2>4. Messaging and Data Rates</h2>
  <p>Standard messaging and data rates from your mobile carrier may apply. Message frequency varies based on your usage and subscription plan.</p>

  <h2>5. Subscription and Payment</h2>
  <p>Phew offers a limited number of free activity recommendations. After the free limit, a paid subscription at $5.99/month is required to continue receiving recommendations. Subscriptions are processed through Stripe and can be cancelled at any time. Refunds are handled on a case-by-case basis.</p>

  <h2>6. AI-Generated Content</h2>
  <p>Activity recommendations are generated using artificial intelligence and are provided for informational purposes only. While we strive for accuracy, we do not guarantee that all activity details (dates, times, prices, availability) are current or accurate. Please verify activity details directly with the venue or organizer before attending.</p>

  <h2>7. Limitation of Liability</h2>
  <p>Phew provides activity suggestions as a convenience. We are not responsible for the quality, safety, or suitability of any recommended activities. Parents and guardians are solely responsible for evaluating whether an activity is appropriate for their family. Phew shall not be liable for any damages arising from your use of our recommendations.</p>

  <h2>8. Intellectual Property</h2>
  <p>All content, branding, and technology associated with Phew are owned by us. You may not copy, modify, or distribute any part of the service without our written permission.</p>

  <h2>9. Acceptable Use</h2>
  <p>You agree not to misuse the service, including but not limited to: sending abusive or harassing messages, attempting to reverse-engineer or disrupt the service, or using the service for any unlawful purpose.</p>

  <h2>10. Modifications</h2>
  <p>We reserve the right to modify these Terms at any time. Continued use of the service after changes constitutes acceptance of the updated terms. We will notify you of material changes via SMS.</p>

  <h2>11. Governing Law</h2>
  <p>These Terms are governed by the laws of the State of New Jersey, without regard to conflict of law principles.</p>

  <h2>12. Contact</h2>
  <p>For questions about these Terms, text us at our Phew number or email odedpo@gmail.com.</p>

  <div class="footer">
    <p>&copy; 2026 Phew. All rights reserved.</p>
  </div>
</body>
</html>`);
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
