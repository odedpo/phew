const express = require('express');
const router = express.Router();
const { handleIncoming } = require('./conversation');
const { sendSMS } = require('../services/twilio');

// Keywords that Twilio auto-handles (STOP/START), but we also handle gracefully
const STOP_KEYWORDS = ['stop', 'unsubscribe', 'cancel', 'end', 'quit'];
const HELP_KEYWORDS = ['help', 'info'];
const START_KEYWORDS = ['start', 'unstop', 'yes'];

router.post('/incoming', async (req, res) => {
  // Acknowledge Twilio immediately (empty TwiML — we send replies via API)
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  const phone = req.body.From;
  const message = req.body.Body;

  if (!phone || !message) return;

  const normalized = message.trim().toLowerCase();

  try {
    // Handle STOP — Twilio auto-blocks further messages, but we log it
    if (STOP_KEYWORDS.includes(normalized)) {
      console.log(`[SMS] STOP received from ${phone}`);
      // Twilio handles the opt-out automatically for A2P messaging services.
      // No need to send a reply — Twilio sends one automatically.
      return;
    }

    // Handle HELP
    if (HELP_KEYWORDS.includes(normalized)) {
      await sendSMS(phone,
        'Phew helps parents find weekend activities for their kids! Text us your zipcode to get started, or text STOP to opt out. For support: odedpo@gmail.com'
      );
      return;
    }

    // Handle START (re-opt-in after STOP)
    if (START_KEYWORDS.includes(normalized)) {
      await sendSMS(phone,
        "Welcome back to Phew! Text me what you're looking for this weekend."
      );
      return;
    }

    await handleIncoming(phone, message);
  } catch (err) {
    console.error('Error handling SMS:', err);
    await sendSMS(phone, "Oops, something went sideways on my end! Try again in a sec.").catch(() => {});
  }
});

module.exports = router;
