const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

async function getRecommendations(user, userMessage) {
  const kids = JSON.parse(user.kids || '[]');
  const pastActivities = JSON.parse(user.past_activities || '[]');
  const kidsDesc = kids.length
    ? kids.map(k => k.name ? `${k.name} (${k.age})` : `age ${k.age}`).join(', ')
    : 'kids';

  const systemPrompt = `You are Phew, a friendly weekend activity assistant for parents.
You give hyper-local, practical, fun activity recommendations for families.

User profile:
- Zipcode: ${user.zipcode}
- Kids: ${kidsDesc}
- Preferences: ${user.preferences || 'none specified'}
- Past activities (avoid repeating): ${pastActivities.slice(-10).join(', ') || 'none yet'}

Rules:
- Always give exactly 3 activity options, numbered 1-3
- Each recommendation: activity name, why it fits their kids, area/neighborhood, rough cost
- Keep it conversational, warm, like a friend texting back
- Be specific to their zipcode area — real places, real suggestions
- Use web knowledge of the area around zipcode ${user.zipcode}
- End with "Reply with a number to get more details, or just tell me what you're in the mood for!"
- Keep total response under 1400 characters (SMS-friendly)
- Max 1-2 emojis per message`;

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

async function getProactiveMessage(user) {
  const kids = JSON.parse(user.kids || '[]');
  const kidsDesc = kids.length
    ? kids.map(k => k.name || `your ${k.age}-year-old`).join(' and ')
    : 'the kids';

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Write a short, warm Thursday SMS from Phew (weekend activity app) to a parent.
Their kids: ${kidsDesc}. Zipcode: ${user.zipcode}.
Ask if they want weekend activity ideas. Max 2 sentences. Casual, friendly. Max 1 emoji.`
      }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error (proactive):', err.message);
    return `Hey! Weekend's almost here — want me to find some fun activities for ${kidsDesc}? Just reply with what you're in the mood for!`;
  }
}

async function getActivityDetails(user, activityName) {
  const kids = JSON.parse(user.kids || '[]');
  const kidsDesc = kids.length
    ? kids.map(k => k.name ? `${k.name} (${k.age})` : `age ${k.age}`).join(', ')
    : 'kids';

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Give details about "${activityName}" near zipcode ${user.zipcode} for kids: ${kidsDesc}.
Include: exact address if known, hours, parking tips, what to bring, age-appropriateness.
Keep it SMS-friendly, conversational, under 5 sentences.`
      }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error (details):', err.message);
    return "Couldn't pull up the details right now — try asking me again!";
  }
}

module.exports = { getRecommendations, getProactiveMessage, getActivityDetails };
