const { getOrCreateUser, updateUser } = require('../services/airtable');
const { getRecommendations, getActivityDetails } = require('../services/claude');
const { sendSMS } = require('../services/twilio');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const FREE_REC_LIMIT = 3;

// In-memory store for last_recommendations (not in Airtable)
const lastRecsCache = {};

async function handleIncoming(phone, message) {
  const user = await getOrCreateUser(phone);
  const msg = message.trim();
  const userPhone = user.phone || user.Phone;
  const userState = user.state || user.State || 'ONBOARDING_ZIPCODE';

  switch (userState) {
    case 'ONBOARDING_ZIPCODE':
      return handleZipcode(user, userPhone, msg);
    case 'ONBOARDING_KIDS':
      return handleKids(user, userPhone, msg);
    case 'ONBOARDING_PREFERENCES':
      return handlePreferences(user, userPhone, msg);
    case 'AWAITING_PAYMENT':
      return handleAwaitingPayment(user, userPhone, msg);
    case 'ACTIVE':
    default:
      return handleActiveUser(user, userPhone, msg);
  }
}

async function handleZipcode(user, phone, msg) {
  const zipcode = msg.replace(/\\D/g, '').substring(0, 5);
  if (zipcode.length !== 5) {
    await sendSMS(phone,
      "Hey! I'm Phew \u2014 I find weekend activities for your kids. First up: what's your zipcode?"
    );
    return;
  }

  await updateUser(user.id, { Zipcode: zipcode, State: 'ONBOARDING_KIDS' });
  await sendSMS(phone,
    \`Got it \u2014 \${zipcode}! Now tell me about your kids. How many and what ages? (e.g. "2 kids, ages 5 and 8")\`
  );
}

async function handleKids(user, phone, msg) {
  const kids = parseKids(msg);

  if (!kids.length) {
    await sendSMS(phone,
      'Just tell me your kids\' ages \u2014 like "5 and 8" or "a 3 year old". I\'ll take it from there!'
    );
    return;
  }

  await updateUser(user.id, { Kids: JSON.stringify(kids), State: 'ONBOARDING_PREFERENCES' });

  await sendSMS(phone,
    \`Love it! One last thing \u2014 any preferences? Indoor/outdoor, budget range, anything they love or hate? (Or just say "surprise me")\`
  );
}

async function handlePreferences(user, phone, msg) {
  const skip = ['skip', 'no', 'nah', 'surprise me', 'none', 'nope'];
  const preferences = skip.includes(msg.toLowerCase()) ? '' : msg;

  await updateUser(user.id, { Preferences: preferences, State: 'ACTIVE' });

  const kidsRaw = user.kids || user.Kids || '[]';
  const kidsData = JSON.parse(kidsRaw);
  const kidsDesc = kidsData.map(k => \`age \${k.age}\`).join(' and ');

  await sendSMS(phone,
    \`Perfect \u2014 you're all set! I know your kids (\${kidsDesc}), your area, and your vibe.\n\nYou get 3 free recommendations. After that it's $4.99/mo \u2014 and every Thursday I'll proactively text you with weekend ideas.\n\nSo \u2014 what are you looking for this weekend?\`
  );
}

async function handleActiveUser(user, phone, msg) {
  const recCount = user.rec_count || user.FreeRecsUsed || 0;
  const isSubscribed = (user.is_subscribed === true) || (user.SubscriptionStatus === 'active');

  // Check paywall
  if (!isSubscribed && recCount >= FREE_REC_LIMIT) {
    return handlePaywall(user, phone);
  }

  // Check if user is asking for details on a previous rec
  const isDetailRequest = /^[1-3]$/.test(msg.trim()) || /more|details|tell me about/i.test(msg);
  const cachedRecs = lastRecsCache[phone];

  if (isDetailRequest && cachedRecs) {
    let activityName = null;
    if (/^[1-3]$/.test(msg.trim())) {
      activityName = cachedRecs[parseInt(msg.trim()) - 1];
    } else {
      activityName = cachedRecs[0];
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

  // Cache recs in memory
  lastRecsCache[phone] = activityNames;

  // Update user profile
  const pastRaw = user.past_activities || user.PastActivities || '[]';
  const pastActivities = JSON.parse(pastRaw);
  const updatedPast = [...pastActivities, ...activityNames].slice(-30);

  await updateUser(user.id, {
    FreeRecsUsed: recCount + 1,
    PastActivities: JSON.stringify(updatedPast)
  });

  await sendSMS(phone, recommendations);

  // Soft paywall warning on last free rec
  const newCount = recCount + 1;
  if (!isSubscribed && newCount === FREE_REC_LIMIT) {
    setTimeout(async () => {
      await sendSMS(phone,
        \`(That was your last free rec! Next time, I'll send you a link to subscribe for $4.99/mo to keep the ideas coming.)\`
      );
    }, 2000);
  }
}

async function handlePaywall(user, phone) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{
      price: process.env.STRIPE_PRICE_ID,
      quantity: 1
    }],
    success_url: \`\${process.env.BASE_URL}/stripe/subscribed?phone=\${encodeURIComponent(phone)}\`,
    cancel_url: \`\${process.env.BASE_URL}/stripe/cancelled\`,
    metadata: { phone: phone }
  });

  await updateUser(user.id, { State: 'AWAITING_PAYMENT' });

  await sendSMS(phone,
    \`You've used your 3 free recs! To keep going (+ get my Thursday weekend heads-up), subscribe for just $4.99/mo:\n\n\${session.url}\n\nOnce you're in, just text me anytime!\`
  );
}

async function handleAwaitingPayment(user, phone, msg) {
  if (/yes|ok|sure|subscribe|paid|done|link/i.test(msg)) {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: \`\${process.env.BASE_URL}/stripe/subscribed?phone=\${encodeURIComponent(phone)}\`,
      cancel_url: \`\${process.env.BASE_URL}/stripe/cancelled\`,
      metadata: { phone: phone }
    });
    await sendSMS(phone, \`Here's your link: \${session.url}\`);
  } else {
    await sendSMS(phone,
      \`Once you subscribe, I'm all yours! Reply "subscribe" and I'll send the link again.\`
    );
  }
}

// Helpers
function parseKids(text) {
  const kids = [];
  const agePattern = /\\b(\\d{1,2})\\s*(?:year[s]?\\s*old|yo|y\\.o\\.?|months?)?\\b/gi;
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
    const match = line.match(/^\\d+[.)]\\s+\\*{0,2}(.+?)\\*{0,2}\\s*(?:[-\u2013\u2014:]|\\s{2})/);
    if (match) names.push(match[1].trim());
  }
  return names.slice(0, 3);
}

module.exports = { handleIncoming };
