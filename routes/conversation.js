const { getOrCreateUser, updateUser } = require('../services/airtable');
const { getRecommendations, getActivityDetails } = require('../services/claude');
const { sendSMS } = require('../services/twilio');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const FREE_REC_LIMIT = 3;

// In-memory cache for last recommendations (per phone)
const lastRecsCache = {};

async function handleIncoming(phone, message) {
  const user = await getOrCreateUser(phone);
  const msg = message.trim();
  const state = user.State || 'ONBOARDING_ZIPCODE';

  switch (state) {
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

  await sendSMS(phone,
    `Love it! One last thing \u2014 any preferences? Indoor/outdoor, budget range, anything they love or hate? (Or just say "surprise me")`
  );
}

async function handlePreferences(user, msg) {
  const phone = user.Phone;
  const skip = ['skip', 'no', 'nah', 'surprise me', 'none', 'nope'];
  const preferences = skip.includes(msg.toLowerCase()) ? '' : msg;

  await updateUser(user.id, { Preferences: preferences, State: 'ACTIVE' });

  const kidsData = JSON.parse(user.Kids || '[]');
  const kidsDesc = kidsData.map(k => `age ${k.age}`).join(' and ');

  await sendSMS(phone,
    `Perfect \u2014 you're all set! I know your kids (${kidsDesc}), your area, and your vibe.\n\nYou get 3 free recommendations. After that it's $5.99/mo \u2014 and every Thursday I'll proactively text you with weekend ideas.\n\nSo \u2014 what are you looking for this weekend?`
  );
}

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

  // Soft paywall warning on last free rec
  const newCount = recCount + 1;
  if (user.SubscriptionStatus !== 'active' && newCount === FREE_REC_LIMIT) {
    setTimeout(async () => {
      await sendSMS(phone,
        `(That was your last free rec! Next time, I'll send you a link to subscribe for $5.99/mo to keep the ideas coming.)`
      );
    }, 2000);
  }
}

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
    `You've used your 3 free recs! To keep going (+ get my Thursday weekend heads-up every week), subscribe for just $5.99/mo:\n\n${session.url}\n\nOnce you're in, just text me and I'll keep finding great stuff for your kids.`
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
      `Once you subscribe, I'm all yours! Reply "subscribe" and I'll send the link again.`
    );
  }
}

// -- Helpers --

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
    const match = line.match(/^\d+[.)]\s+\*{0,2}(.+?)\*{0,2}\s*(?:[-\u2013\u2014:]|\s{2})/);
    if (match) names.push(match[1].trim());
  }
  return names.slice(0, 3);
}

module.exports = { handleIncoming };
