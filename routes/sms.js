const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { handleIncoming } = require('./conversation');

router.post('/incoming', async (req, res) => {
  // Twilio signature validation (disabled for now due to proxy URL mismatch)
  // TODO: Re-enable once URL matching is confirmed
  // if (process.env.NODE_ENV === 'production') {
  //   const twilioSignature = req.headers['x-twilio-signature'];
  //   const url = \`\${process.env.BASE_URL}/sms/incoming\`;
  //   const isValid = twilio.validateRequest(
  //     process.env.TWILIO_AUTH_TOKEN,
  //     twilioSignature,
  //     url,
  //     req.body
  //   );
  //   if (!isValid) {
  //     console.warn('Invalid Twilio signature — rejecting request');
  //     return res.status(403).send('Forbidden');
  //   }
  // }

  // Acknowledge Twilio immediately (empty TwiML — we send replies via API)
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  // Handle the message asynchronously
  const phone = req.body.From;
  const message = req.body.Body;

  if (!phone || !message) return;

  try {
    await handleIncoming(phone, message);
  } catch (err) {
    console.error('Error handling SMS:', err);
    const { sendSMS } = require('../services/twilio');
    await sendSMS(phone, "Oops, something went sideways on my end! Try again in a sec.").catch(() => {});
  }
});

module.exports = router;
