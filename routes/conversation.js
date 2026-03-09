const { getOrCreateUser, updateUser } = require('../services/airtable');
const { getRecommendations, getActivityDetails, processFeedback, updateLearningProfile } = require('../services/claude');
const { sendSMS } = require('../services/twilio');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const FREE_REC_LIMIT = 3;

// In-memory cache for last recommendations (per phone)
const lastRecsCache = {};

// ── Main entry point ─────────────────────────────────────────────────────────

async function handleIncoming(phone, message) {
  const user = await getOrCreateUser(phone);
  const msg = message.trim();
  const state = user.State || 'ONBOARDING_ZIPCODE';

  // Track last active
  await updateUser(user.id, { LastActiveDate: new Date().toISOString() });

  switch (state) {
    case 'ONBOARDING_ZIPCODE':
      return handleZipcode(user, msg);
    case 'ONBOARDING_KIDS':
      return handleKids(user, msg);
    case 'ONBOARDING_PREFERENCES':
      return handlePreferences(user, msg);
    case 'AWAITING_PAYMENT':
      return handleAwaitingPayment(user, msg);
    case 'AWAITING_FEEDBACK':
      return handleFeedbackReply(user, msg);
    case 'ACTIVE':
    default:
      return handleActiveUser(user, msg);
  }
}

// ── Onboarding ───────────────────────────────────────────────────────────────

async function handleZipcode(user, msg) {
  const phone = user.Phone;
  const zipcode = msg.replace(/\D/g, '').substring(0, 5);
  if (zipcode.length !== 5) {
    await sendSMS(phone,
      "Hey! I'm Phew \u2014 I find weekend activities for your kids. First up: what's your zipcode?"
    );
    return;
  }

  await updateUser(user.id, { Zipcode: zipcode, State: 'ONBOARDING_KIDS' });
  await sendSMS(phone,
    `Got it \u2014 ${zipcode}! Now tell me about your kids. How many and what ages? (e.g. "2 kids, ages 5 and 8")`
  );
}

async function handleKids(user, msg) {
  const phone = user.Phone;
  const kids = parseKids(msg);

  if (!kids.length) {
    await sendSMS(phone,
      'Just tell me your kids\' ages \u2014 like "5 and 8" or "a 3 year old". I\'ll take it from there!'
    );
    return;
  }

  await updateUser(user.id, { Kids: JSON.stringify(kids), State: 'ONBOARDING_PREFERENCES' });

  const kidsDesc = kids.map(k => `${k.age}`).join(' and ');
  await sendSMS(phone,
    `Love it! One last thing \u2014 any preferences? Indoor/outdoor, budget range, anything they love or hate? (Or just say "surprise me")`
  );
}

async function handlePreferences(user, msg) {
  const phone = user.Phone;
  const skip = ['skip', 'no', 'nah', 'surprise me', 'none', 'nope', 'anything'];
  const preferences = skip.includes(msg.toLowerCase()) ? '' : msg;

  const kids = JSON.parse(user.Kids || '[]');
  const kidsDesc = kids.map(k => `your ${k.age}-year-old`).join(' and ');

  await updateUser(user.id, { Preferences: preferences, State: 'ACTIVE' });

  await sendSMS(phone,
    `Perfect \u2014 you're all set! I'll get to know ${kidsDesc} better over time as we chat.\n\nYou get 3 free recs to start. After that it's $5.99/mo and I'll text you every Thursday with a personalized weekend pick.\n\nSo \u2014 what are you looking for this weekend?`
  );
}

// ── Active user handling ─────────────────────────────────────────────────────

async function handleActiveUser(user, msg) {
  const phone = user.Phone;
  const recCount = user.FreeRecsUsed || 0;

  // Check paywall
  if (user.SubscriptionStatus !== 'active' && recCount >= FREE_REC_LIMIT) {
    return handlePaywall(user);
  }

  // Check if user is asking for details on a previous rec
  const isDetailRequest = /^[1-3]$/.test(msg.trim()) || /more|details|tell me about/i.test(msg);

  if (isDetailRequest && lastRecsCache[phone]) {
    const recs = lastRecsCache[phone];
    let activityName = null;

    if (/^[1-3]$/.test(msg.trim())) {
      activityName = recs[parseInt(msg.trim()) - 1];
    } else {
      activityName = recs[0];
    }

    if (activityName) {
      const details = await getActivityDetails(user, activityName);
      await sendSMS(phone, details);
      // Log this exchange
      await logConversation(user, msg, details);
      return;
    }
  }

  // Generate new recommendations
  const recommendations = await getRecommendations(user, msg);
  const activityNames = extractActivityNames(recommendations);

  // Cache recommendations in memory
  lastRecsCache[phone] = activityNames;

  // Update user profile
  const pastActivities = JSON.parse(user.PastActivities || '[]');
  const updatedPast = [...pastActivities, ...activityNames].slice(-30);

  await updateUser(user.id, {
    FreeRecsUsed: recCount + 1,
    PastActivities: JSON.stringify(updatedPast)
  });

  await sendSMS(phone, recommendations);

  // Log conversation (both sides)
  await logConversation(user, msg, recommendations);

  // Soft paywall warning on last free rec
  const newCount = recCount + 1;
  if (user.SubscriptionStatus !== 'active' && newCount === FREE_REC_LIMIT) {
    setTimeout(async () => {
      await sendSMS(phone,
        `(That was your last free rec! Next time, I'll send you a link to subscribe for $5.99/mo to keep the ideas coming \u2014 plus a personalized pick every Thursday.)`
      );
    }, 2000);
  }

  // Periodically update learning profile (every 4 interactions)
  if ((recCount + 1) % 4 === 0) {
    try {
      // Re-fetch user to get latest data
      const freshUser = await require('../services/airtable').getOrCreateUser(phone);
      const newNotes = await updateLearningProfile(freshUser);
      if (newNotes) {
        await updateUser(user.id, { LearningNotes: newNotes });
      }
    } catch (err) {
      console.error('Learning profile update failed:', err.message);
    }
  }
}

// ── Feedback handling (Monday follow-up replies) ─────────────────────────────

async function handleFeedbackReply(user, msg) {
  const phone = user.Phone;

  // Process the feedback with Claude
  const feedback = await processFeedback(user, msg);

  // Store feedback
  const existingFeedback = JSON.parse(user.ActivityFeedback || '[]');
  existingFeedback.push({
    ...feedback,
    date: new Date().toISOString(),
    rawMessage: msg.substring(0, 200)
  });

  // Move back to ACTIVE state
  await updateUser(user.id, {
    State: 'ACTIVE',
    ActivityFeedback: JSON.stringify(existingFeedback.slice(-20))
  });

  // Respond based on sentiment
  if (feedback.sentiment === 'positive') {
    await sendSMS(phone,
      `That's awesome! I'll remember that${feedback.activity ? ` \u2014 ${feedback.activity} is a hit` : ''}. I'll find more stuff like that for you. Text me anytime or wait for my Thursday pick!`
    );
  } else if (feedback.sentiment === 'negative') {
    await sendSMS(phone,
      `Bummer, sorry to hear that. Good to know though \u2014 I'll steer away from stuff like that next time. Want me to find something different for this coming weekend?`
    );
  } else if (feedback.sentiment === 'no_activity') {
    await sendSMS(phone,
      `No worries \u2014 not every weekend needs a plan! I'll have a fresh idea for you on Thursday. Or text me anytime you're looking for something to do.`
    );
  } else {
    await sendSMS(phone,
      `Got it, thanks for letting me know! I'll keep that in mind. Text me anytime for new ideas!`
    );
  }

  // Log conversation
  await logConversation(user, msg, '[feedback processed]');

  // Update learning profile after feedback
  try {
    const freshUser = await require('../services/airtable').getOrCreateUser(phone);
    const newNotes = await updateLearningProfile(freshUser);
    if (newNotes) {
      await updateUser(user.id, { LearningNotes: newNotes });
    }
  } catch (err) {
    console.error('Learning profile update after feedback failed:', err.message);
  }
}

// ── Payment handling ─────────────────────────────────────────────────────────

async function handlePaywall(user) {
  const phone = user.Phone;
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{
      price: process.env.STRIPE_PRICE_ID,
      quantity: 1
    }],
    success_url: `${process.env.BASE_URL}/stripe/subscribed`,
    cancel_url: `${process.env.BASE_URL}/stripe/cancelled`,
    metadata: { phone: phone }
  });

  await updateUser(user.id, { State: 'AWAITING_PAYMENT' });

  await sendSMS(phone,
    `You've used your 3 free recs! To keep going (+ get my personalized Thursday picks every week), subscribe for $5.99/mo:\n\n${session.url}\n\nI'll keep getting smarter about what your family loves.`
  );
}

async function handleAwaitingPayment(user, msg) {
  const phone = user.Phone;
  if (/yes|ok|sure|subscribe|paid|done|link/i.test(msg)) {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL}/stripe/subscribed`,
      cancel_url: `${process.env.BASE_URL}/stripe/cancelled`,
      metadata: { phone: phone }
    });
    await sendSMS(phone, `Here's your link: ${session.url}`);
  } else {
    await sendSMS(phone,
      `Once you subscribe, I'm all yours \u2014 and I only get better over time! Reply "subscribe" and I'll send the link again.`
    );
  }
}

// ── Conversation logging ─────────────────────────────────────────────────────

async function logConversation(user, userMsg, botMsg) {
  try {
    const history = JSON.parse(user.ConversationHistory || '[]');

    history.push({
      role: 'user',
      text: userMsg.substring(0, 300),
      ts: new Date().toISOString()
    });
    history.push({
      role: 'phew',
      text: botMsg.substring(0, 300),
      ts: new Date().toISOString()
    });

    // Keep last 20 messages (10 exchanges)
    const trimmed = history.slice(-20);

    await updateUser(user.id, {
      ConversationHistory: JSON.stringify(trimmed)
    });
  } catch (err) {
    console.error('Failed to log conversation:', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseKids(text) {
  const kids = [];
  const agePattern = /\b(\d{1,2})\s*(?:year[s]?\s*old|yo|y\.o\.?|months?)?/gi;
  const matches = [...text.matchAll(agePattern)];

  for (const match of matches) {
    const age = parseInt(match[1]);
    if (age >= 0 && age <= 17) {
      kids.push({ age });
    }
  }

  return kids;
}

function extractActivityNames(recommendationsText) {
  const lines = recommendationsText.split('\n');
  const names = [];
  for (const line of lines) {
    // Match patterns like "1) Activity Name —" or "1. **Activity Name** -"
    const match = line.match(/^\d[.)]\s+\*{0,2}(.+?)\*{0,2}\s*(?:[-\u2013\u2014:(\[]|\s{2})/);
    if (match) names.push(match[1].trim());
  }
  return names.slice(0, 3);
}

module.exports = { handleIncoming };
