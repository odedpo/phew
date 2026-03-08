const express = require('express');
const router = express.Router();
const { handleIncoming } = require('./conversation');

router.post('/incoming', async (req, res) => {
  // TODO: Re-enable Twilio signature validation once URL matching is confirmed
  // Signature validation is disabled because Render's reverse proxy
  // causes URL mismatch in Twilio's signature computation

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
