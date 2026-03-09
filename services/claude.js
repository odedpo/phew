const Anthropic = require('@anthropic-ai/sdk');
const { fetchLocalEvents } = require('./events');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentContext() {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const dayName = days[now.getDay()];
  const monthName = months[now.getMonth()];
  const date = now.getDate();
  const year = now.getFullYear();

  // Determine season
  const month = now.getMonth();
  let season;
  if (month >= 2 && month <= 4) season = 'spring';
  else if (month >= 5 && month <= 7) season = 'summer';
  else if (month >= 8 && month <= 10) season = 'fall/autumn';
  else season = 'winter';

  // Days until weekend
  const day = now.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7;
  const weekendNote = daysUntilSaturday === 0 ? "It's Saturday!" :
    daysUntilSaturday === 1 ? "Tomorrow is Saturday!" :
    day === 0 ? "It's Sunday!" :
    `${daysUntilSaturday} days until Saturday.`;

  return {
    dateString: `${dayName}, ${monthName} ${date}, ${year}`,
    season,
    weekendNote,
    dayName
  };
}

function buildKidsDescription(user) {
  const kids = JSON.parse(user.Kids || '[]');
  if (!kids.length) return 'kids (ages unknown)';
  return kids.map(k => k.name ? `${k.name} (age ${k.age})` : `a ${k.age}-year-old`).join(' and ');
}

function buildConversationContext(user) {
  const history = JSON.parse(user.ConversationHistory || '[]');
  if (!history.length) return '';

  // Show last 6 exchanges max
  const recent = history.slice(-6);
  return '\nRecent conversation:\n' +
    recent.map(h => `- ${h.role === 'user' ? 'Parent' : 'Phew'}: ${h.text.substring(0, 200)}`).join('\n');
}

function buildFeedbackContext(user) {
  const feedback = JSON.parse(user.ActivityFeedback || '[]');
  if (!feedback.length) return '';

  const recent = feedback.slice(-8);
  const loved = recent.filter(f => f.sentiment === 'positive').map(f => f.activity);
  const disliked = recent.filter(f => f.sentiment === 'negative').map(f => f.activity);

  let context = '\nWhat we know from past feedback:';
  if (loved.length) context += `\n- They loved: ${loved.join(', ')}`;
  if (disliked.length) context += `\n- Didn't enjoy: ${disliked.join(', ')}`;
  return context;
}

// ── Main recommendation engine ───────────────────────────────────────────────

async function getRecommendations(user, userMessage) {
  const kidsDesc = buildKidsDescription(user);
  const pastActivities = JSON.parse(user.PastActivities || '[]');
  const { dateString, season, weekendNote } = getCurrentContext();
  const conversationContext = buildConversationContext(user);
  const feedbackContext = buildFeedbackContext(user);
  const learningNotes = user.LearningNotes || '';

  // Fetch real-time event context
  const kids = JSON.parse(user.Kids || '[]');
  let eventContext = '';
  try {
    const events = await fetchLocalEvents(user.Zipcode, kids);
    if (events && events.type === 'seasonal_context') {
      eventContext = `\nSEASONAL CONTEXT (${events.month}, ${events.season}):
${events.hints.map(h => `- ${h}`).join('\n')}`;
    } else if (Array.isArray(events) && events.length) {
      eventContext = `\nREAL EVENTS FOUND NEAR ${user.Zipcode} THIS WEEKEND:
${events.slice(0, 5).map(e => `- ${e.title}: ${e.snippet}`).join('\n')}
Use these real events in your recommendations when they're family-appropriate!`;
    }
  } catch (err) {
    console.log('[Claude] Event fetch failed, continuing without:', err.message);
  }

  const systemPrompt = `You are Phew — a smart, warm weekend activity assistant that knows this family personally. You're like a local friend who always has great ideas for what to do with kids.

TODAY: ${dateString} (${season}). ${weekendNote}

FAMILY PROFILE:
- Location: ${user.Zipcode}
- Kids: ${kidsDesc}
- Stated preferences: ${user.Preferences || 'none yet'}
- Past activities suggested (avoid repeating): ${pastActivities.slice(-15).join(', ') || 'none yet'}
${learningNotes ? `\nWHAT YOU'VE LEARNED ABOUT THIS FAMILY:\n${learningNotes}` : ''}
${feedbackContext}
${conversationContext}
${eventContext}

RULES:
1. Give exactly 3 activity options, numbered 1-3
2. Each: name, ONE line on why it's great for THEIR specific kids, neighborhood/distance, rough cost
3. Factor in the SEASON and WEATHER — it's ${season} in the Northeast. Be realistic about what's available/enjoyable right now.
4. Be hyper-specific to their area around zipcode ${user.Zipcode}. Name real places.
5. Mix it up: ideally one seasonal/timely pick, one reliable local staple, one hidden gem or free option
6. If seasonal context or real events are provided above, work them in naturally — these are timely and make your picks feel current.
7. If you've learned things about this family from past conversations, USE that knowledge. Reference it naturally ("since your 5-year-old loved the nature center last time..." or "I know you prefer staying close to home...")
8. End with: "Reply 1, 2, or 3 for details — or tell me what you're in the mood for!"
9. Keep TOTAL response under 1400 characters
10. Tone: casual, warm, like a text from a friend. Not salesy. 1-2 emojis max.
11. IMPORTANT: You're recommending based on training knowledge + seasonal context. Some details (hours, prices) may have changed — don't present uncertain details as definitive facts. For timely events, say "check their site for this weekend's times."`;


  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error (recommendations):', err.message);
    return "I'm having a brain freeze right now — give me a sec and try again!";
  }
}

// ── Activity details ─────────────────────────────────────────────────────────

async function getActivityDetails(user, activityName) {
  const kidsDesc = buildKidsDescription(user);
  const { season } = getCurrentContext();

  const systemPrompt = `You are Phew — a friendly weekend activity assistant. You're giving details about an activity to a parent. Stay warm and conversational, like a friend texting tips.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Give me the scoop on "${activityName}" near zipcode ${user.Zipcode} for a family with ${kidsDesc}. It's ${season}.

Include: where exactly it is, what to expect, parking situation, what to bring, and any tips for their ages.

IMPORTANT: If you're not 100% certain about hours, prices, or seasonal availability, say "you'll want to double-check hours before heading out" or similar. Don't state uncertain facts as definitive.

Keep it under 600 characters. SMS-friendly, conversational.`
      }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error (details):', err.message);
    return "Couldn't pull up the details right now — try asking me again!";
  }
}

// ── Thursday proactive message (now delivers actual value) ───────────────────

async function getProactiveMessage(user) {
  const kidsDesc = buildKidsDescription(user);
  const { dateString, season } = getCurrentContext();
  const feedbackContext = buildFeedbackContext(user);
  const learningNotes = user.LearningNotes || '';

  // Get seasonal context for timely suggestions
  const kids = JSON.parse(user.Kids || '[]');
  let eventHints = '';
  try {
    const events = await fetchLocalEvents(user.Zipcode, kids);
    if (events && events.type === 'seasonal_context') {
      eventHints = `\nTimely things happening: ${events.hints.slice(0, 3).join('; ')}`;
    } else if (Array.isArray(events) && events.length) {
      eventHints = `\nReal events this weekend: ${events.slice(0, 2).map(e => e.title).join('; ')}`;
    }
  } catch (err) { /* continue without events */ }

  const systemPrompt = `You are Phew — a weekend activity assistant that knows this family. It's Thursday afternoon. You're texting them with ONE specific weekend activity pick, tailored to what you know about them.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Write a Thursday afternoon text to a parent near zipcode ${user.Zipcode}. Their kids: ${kidsDesc}. It's ${season} (${dateString}).
${learningNotes ? `What you know about them: ${learningNotes}` : ''}
${feedbackContext}
${eventHints}

Give them ONE specific, compelling weekend activity pick — not a generic "want ideas?" but an actual recommendation with a reason it's great for their family right now. If there's something seasonal or timely, lean into that.

Then invite them to reply for more options.

Max 400 characters. Casual, warm, 1 emoji max. Feel like a friend who just spotted something perfect for their kids.`
      }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error (proactive):', err.message);
    return `Hey! Weekend's almost here — want me to find some fun activities for ${kidsDesc}? Just reply with what you're in the mood for!`;
  }
}

// ── Monday follow-up ─────────────────────────────────────────────────────────

async function getMondayFollowUp(user) {
  const kidsDesc = buildKidsDescription(user);
  const pastActivities = JSON.parse(user.PastActivities || '[]');
  const lastSuggested = pastActivities.slice(-3);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Write a short Monday afternoon text from Phew (weekend activity app) to a parent with ${kidsDesc}.
${lastSuggested.length ? `Last time we suggested: ${lastSuggested.join(', ')}` : ''}

Ask casually how their weekend went and if they checked out anything fun with the kids.
Make it feel natural — like a friend checking in, not a survey.
Max 200 characters. 1 emoji max.`
      }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error (monday):', err.message);
    return "Hey! How was the weekend? Did you and the kids end up doing anything fun? 😊";
  }
}

// ── Process feedback from user responses ─────────────────────────────────────

async function processFeedback(user, message) {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `A parent replied to "how was your weekend?" with: "${message}"

Extract:
1. sentiment: "positive", "negative", "neutral", or "no_activity" (if they didn't do anything)
2. activity: name of the activity they mention (or null)
3. details: any useful info about what the kids liked/disliked (or null)

Reply ONLY in JSON format like: {"sentiment": "positive", "activity": "Bergen County Zoo", "details": "kids loved the goats"}`
      }]
    });

    const text = response.content[0].text.trim();
    // Extract JSON even if wrapped in backticks
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { sentiment: 'neutral', activity: null, details: null };
  } catch (err) {
    console.error('Claude API error (feedback):', err.message);
    return { sentiment: 'neutral', activity: null, details: null };
  }
}

// ── Update learning profile ──────────────────────────────────────────────────

async function updateLearningProfile(user) {
  const feedback = JSON.parse(user.ActivityFeedback || '[]');
  const history = JSON.parse(user.ConversationHistory || '[]');
  const kidsDesc = buildKidsDescription(user);

  if (feedback.length < 2 && history.length < 6) {
    return null; // Not enough data to learn from yet
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Based on these interactions with a parent (${kidsDesc}, zipcode ${user.Zipcode}), write a brief profile of what you've learned about this family. This will be used to personalize future recommendations.

Conversation history (last 10):
${history.slice(-10).map(h => `${h.role}: ${h.text.substring(0, 150)}`).join('\n')}

Activity feedback:
${feedback.map(f => `${f.activity || 'unknown'}: ${f.sentiment}${f.details ? ' — ' + f.details : ''}`).join('\n')}

Current preferences stated: ${user.Preferences || 'none'}

Write 3-5 bullet points summarizing what you've learned: their real preferences (not just stated ones), what their kids enjoy, budget sensitivity, travel willingness, energy level, any patterns. Keep each bullet under 100 chars. Be specific and actionable for future recommendations.`
      }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error (learning):', err.message);
    return null;
  }
}

module.exports = {
  getRecommendations,
  getProactiveMessage,
  getActivityDetails,
  getMondayFollowUp,
  processFeedback,
  updateLearningProfile
};
