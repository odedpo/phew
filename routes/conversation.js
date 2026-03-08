const { getOrCreateUser, updateUser } = require('../services/airtable');
const { getRecommendations, getActivityDetails } = require('../services/claude');
const { sendSMS } = require('../services/twilio');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const FREE_REC_LIMIT = 3;

async function handleIncoming(phone, message) {
  const user = await getOrCreateUser(phone);
  const msg = message.trim();

  switch (user.state) {
    case 'ONBOARDING_ZIPCODE':
      return handleZipcode(user, msg);
    case 'ONBOARDING_KIDS':
      return handleKids(user, msg);
    case 'ONBOARDING_PREFERENCES':
      return handlePreferences(user, msg);
    case 'AWAITING_PAYMENT':
      return handleAwaitingPayment(user, msg);
    case 'ACTIVE':
    default:
      return handleActiveUser(user, msg);
  }
}

async function handleZipcode(user, msg) {
  const zipcode = msg.replace(/\D/g, '').substring(0, 5);
  if (zipcode.length !== 5) {
    await sendSMS(user.phone,
      "Hey! I'm Phew — I find weekend activities for your kids. First up: what's your zipcode?"
    );
    return;
  }

  await updateUser(user.id, { zipcode, state: 'ONBOARDING_KIDS' });
  await sendSMS(user.phone,
    `Got it — ${zipcode}! Now tell me about your kids. How many and what ages? (e.g. "2 kids, ages 5 and 8")`
  );
}

async function handleKids(user, msg) {
  const kids = parseKids(msg);

  if (!kids.length) {
    await sendSMS(user.phone,
      'Just tell me your kids\' ages — like "5 and 8" or "a 3 year old". I\'ll take it from there!'
    );
    return;
  }

  await updateUser(user.id, { kids: JSON.stringify(kids), state: 'ONBOARDING_PREFERENCES' });

  await sendSMS(user.phone,
    `Love it! One last thing — any preferences? Indoor/outdoor, budget range, anything they love or hate? (Or just say "surprise me")`
  );
}

async function handlePreferences(user, msg) {
  const skip = ['skip', 'no', 'nah', 'surprise me', 'none', 'nope'];
  const preferences = skip.includes(msg.toLowerCase()) ? '' : msg;

  await updateUser(user.id, { preferences, state: 'ACTIVE' });

  const kidsData = JSON.parse(user.kids || '[]');
  const kidsDesc = kidsData.map(k => `age ${k.age}`).join(' and ');

  await sendSMS(user.phone,
    `Perfect — you're all set! I know your kids (${kidsDesc}), your area, and your vibe.\n\nYou get 3 free recommendations. After that it's $5.99/mo — and every Thursday I'll proactively text you with weekend ideas.\n\nSo — what are you looking for this weekend?`
  );
}

async function handleActiveUser(user, msg) {
  const recCount = user.rec_count || 0;

  // Check paywall
  if (!user.is_subscribed && recCount >= FREE_REC_LIMIT) {
    return handlePaywall(user);
  }

  // Check if user is asking for details on a previous rec
  const isDetailRequest = /^[1-3]$/.test(msg.trim()) || /more|details|tell me about/i.test(msg);

  if (isDetailRequest && user.last_recommendations) {
    const recs = JSON.parse(user.last_recommendations);
    let activityName = null;

    if (/^[1-3]$/.test(msg.trim())) {
      activityName = recs[parseInt(msg.trim()) - 1];
    } else {
      activityName = recs[0];
    }

    if (activityName) {
      const details = await getActivityDetails(user, activityName);
      await sendSMS(user.phone, details);
      return;
    }
  }

  // Generate new recommendations
  const recommendations = await getRecommendations(user, msg);
  const activityNames = extractActivityNames(recommendations);

  // Update user profile
  const pastActivities = JSON.parse(user.past_activities || '[]');
  const updatedPast = [...pastActivities, ...activityNames].slice(-30);

  await updateUser(user.id, {
    rec_count: recCount + 1,
    last_recommendations: JSON.stringify(activityNames),
    past_activities: JSON.stringify(updatedPast),
    last_active: new Date().toISOString()
  });

  await sendSMS(user.phone, recommendations);

  // Soft paywall warning on last free rec
  const newCount = recCount + 1;
  if (!user.is_subscribed && newCount === FREE_REC_LIMIT) {
    setTimeout(async () => {
      await sendSMS(user.phone,
        `(That was your last free rec! Next time, I'll send you a link to subscribe for $5.99/mo to keep the ideas coming.)`
      );
    }, 2000);
  }
}

async function handlePaywall(user) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{
      price: process.env.STRIPE_PRICE_ID,
      quantity: 1
    }],
    success_url: `${process.env.BASE_URL}/stripe/subscribed?phone=${encodeURIComponent(user.phone)}`,
    cancel_url: `${process.env.BASE_URL}/stripe/cancelled`,
    metadata: { phone: user.phone }
  });

  await updateUser(user.id, { state: 'AWAITING_PAYMENT', stripe_session_id: session.id });

  await sendSMS(user.phone,
    `You've used your 3 free recs! To keep going (+ get my Thursday weekend heads-up every week), subscribe for just $5.99/mo:\n\n${session.url}\n\nOnce you're in, just text me and I'll keep finding great stuff for your kids.`
  );
}

async function handleAwaitingPayment(user, msg) {
  if (/yes|ok|sure|subscribe|paid|done|link/i.test(msg)) {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL}/stripe/subscribed?phone=${encodeURIComponent(user.phone)}`,
      cancel_url: `${process.env.BASE_URL}/stripe/cancelled`,
      metadata: { phone: user.phone }
    });
    await sendSMS(user.phone, `Here's your link: ${session.url}`);
  } else {
    await sendSMS(user.phone,
      `Once you subscribe, I'm all yours! Reply "subscribe" and I'll send the link again.`
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseKids(text) {
  const kids = [];
  const agePattern = /\b(\d{1,2})\s*(?:year[s]?\s*old|yo|y\.o\.?|months?)?\b/gi;
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
    // Match "1. Activity Name — description" or "1) Activity Name: description"
    const match = line.match(/^\d+[.)]\s+\*{0,2}(.+?)\*{0,2}\s*(?:[-–—:]|\s{2})/);
    if (match) names.push(match[1].trim());
  }
  return names.slice(0, 3);
}

module.exports = { handleIncoming };
