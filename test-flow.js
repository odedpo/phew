/**
 * Test script: simulates the full Phew user journey
 * Calls the real Claude API to see actual recommendation quality
 */
require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

// Simulated user profile (Tenafly, NJ parent with 2 kids)
const testUser = {
  Phone: '+15551234567',
  Zipcode: '07670',
  Kids: JSON.stringify([{ age: 5 }, { age: 8 }]),
  Preferences: 'outdoor activities, budget-friendly, nothing too far',
  PastActivities: JSON.stringify([]),
  FreeRecsUsed: 0,
  SubscriptionStatus: null,
  State: 'ACTIVE'
};

const DIVIDER = '\n' + '='.repeat(70) + '\n';

async function testOnboardingMessages() {
  console.log(DIVIDER);
  console.log('📱 ONBOARDING FLOW (hardcoded messages — no Claude call)');
  console.log(DIVIDER);

  console.log('👤 User texts: "hi"');
  console.log('📤 Phew replies:');
  console.log(`   "Hey! I'm Phew — I find weekend activities for your kids. First up: what's your zipcode?"`);

  console.log('\n👤 User texts: "07670"');
  console.log('📤 Phew replies:');
  console.log(`   "Got it — 07670! Now tell me about your kids. How many and what ages? (e.g. "2 kids, ages 5 and 8")"`);

  console.log('\n👤 User texts: "2 kids, 5 and 8"');
  console.log('📤 Phew replies:');
  console.log(`   "Love it! One last thing — any preferences? Indoor/outdoor, budget range, anything they love or hate? (Or just say "surprise me")"`);

  console.log('\n👤 User texts: "outdoor stuff, budget friendly"');
  console.log('📤 Phew replies:');
  console.log(`   "Perfect — you're all set! I know your kids (age 5 and age 8), your area, and your vibe.\n\n   You get 3 free recommendations. After that it's $5.99/mo — and every Thursday I'll proactively text you with weekend ideas.\n\n   So — what are you looking for this weekend?"`);
}

async function testRecommendations(userMessage) {
  const kids = JSON.parse(testUser.Kids);
  const pastActivities = JSON.parse(testUser.PastActivities);
  const kidsDesc = kids.map(k => `age ${k.age}`).join(', ');

  const systemPrompt = `You are Phew, a friendly weekend activity assistant for parents.
You give hyper-local, practical, fun activity recommendations for families.

User profile:
- Zipcode: ${testUser.Zipcode}
- Kids: ${kidsDesc}
- Preferences: ${testUser.Preferences}
- Past activities (avoid repeating): ${pastActivities.slice(-10).join(', ') || 'none yet'}

Rules:
- Always give exactly 3 activity options, numbered 1-3
- Each recommendation: activity name, why it fits their kids, area/neighborhood, rough cost
- Keep it conversational, warm, like a friend texting back
- Be specific to their zipcode area — real places, real suggestions
- Use web knowledge of the area around zipcode ${testUser.Zipcode}
- End with "Reply with a number to get more details, or just tell me what you're in the mood for!"
- Keep total response under 1400 characters (SMS-friendly)
- Max 1-2 emojis per message`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  return response.content[0].text;
}

async function testActivityDetails(activityName) {
  const kids = JSON.parse(testUser.Kids);
  const kidsDesc = kids.map(k => `age ${k.age}`).join(', ');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Give details about "${activityName}" near zipcode ${testUser.Zipcode} for kids: ${kidsDesc}.
Include: exact address if known, hours, parking tips, what to bring, age-appropriateness.
Keep it SMS-friendly, conversational, under 5 sentences.`
    }]
  });

  return response.content[0].text;
}

async function testProactiveMessage() {
  const kids = JSON.parse(testUser.Kids);
  const kidsDesc = kids.map(k => `your ${k.age}-year-old`).join(' and ');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Write a short, warm Thursday SMS from Phew (weekend activity app) to a parent.
Their kids: ${kidsDesc}. Zipcode: ${testUser.Zipcode}.
Ask if they want weekend activity ideas. Max 2 sentences. Casual, friendly. Max 1 emoji.`
    }]
  });

  return response.content[0].text;
}

async function run() {
  try {
    // 1. Onboarding
    await testOnboardingMessages();

    // 2. First recommendation request
    console.log(DIVIDER);
    console.log('🎯 TEST 1: First recommendation (generic request)');
    console.log(DIVIDER);
    console.log('👤 User texts: "What should we do this weekend?"');
    const rec1 = await testRecommendations('What should we do this weekend?');
    console.log('📤 Phew replies:');
    console.log(rec1);
    console.log(`\n   📏 Length: ${rec1.length} chars (limit: 1400)`);

    // 3. Second recommendation (specific request)
    console.log(DIVIDER);
    console.log('🎯 TEST 2: Specific request');
    console.log(DIVIDER);
    console.log('👤 User texts: "anything with animals? my kids love animals"');
    const rec2 = await testRecommendations('anything with animals? my kids love animals');
    console.log('📤 Phew replies:');
    console.log(rec2);
    console.log(`\n   📏 Length: ${rec2.length} chars (limit: 1400)`);

    // 4. Detail drill-down
    console.log(DIVIDER);
    console.log('🎯 TEST 3: Detail drill-down (user replies "1")');
    console.log(DIVIDER);
    // Extract first activity name from rec2
    const lines = rec2.split('\n');
    let firstActivity = null;
    for (const line of lines) {
      const match = line.match(/^1[.)]\s+\*{0,2}(.+?)\*{0,2}\s*(?:[-–—:]|\s{2})/);
      if (match) { firstActivity = match[1].trim(); break; }
    }
    if (!firstActivity) {
      // Fallback — grab text after "1." or "1)"
      for (const line of lines) {
        const match = line.match(/^1[.)]\s+(.+)/);
        if (match) { firstActivity = match[1].substring(0, 40).trim(); break; }
      }
    }
    console.log(`   (Extracted activity name: "${firstActivity}")`);
    if (firstActivity) {
      const details = await testActivityDetails(firstActivity);
      console.log('📤 Phew replies:');
      console.log(details);
      console.log(`\n   📏 Length: ${details.length} chars`);
    }

    // 5. Thursday proactive message
    console.log(DIVIDER);
    console.log('🎯 TEST 4: Thursday proactive message');
    console.log(DIVIDER);
    const proactive = await testProactiveMessage();
    console.log('📤 Phew sends (Thursday 4pm):');
    console.log(proactive);
    console.log(`\n   📏 Length: ${proactive.length} chars`);

    // 6. Edge case: rainy day
    console.log(DIVIDER);
    console.log('🎯 TEST 5: Edge case — rainy day indoor request');
    console.log(DIVIDER);
    console.log('👤 User texts: "it\'s going to rain all weekend, need indoor ideas"');
    const rec3 = await testRecommendations("it's going to rain all weekend, need indoor ideas");
    console.log('📤 Phew replies:');
    console.log(rec3);
    console.log(`\n   📏 Length: ${rec3.length} chars (limit: 1400)`);

    // 7. Edge case: very brief message
    console.log(DIVIDER);
    console.log('🎯 TEST 6: Edge case — super vague message');
    console.log(DIVIDER);
    console.log('👤 User texts: "bored"');
    const rec4 = await testRecommendations('bored');
    console.log('📤 Phew replies:');
    console.log(rec4);
    console.log(`\n   📏 Length: ${rec4.length} chars (limit: 1400)`);

    // Summary
    console.log(DIVIDER);
    console.log('✅ ALL TESTS COMPLETE');
    console.log(DIVIDER);

  } catch (err) {
    console.error('Test failed:', err.message);
    if (err.message.includes('apiKey')) {
      console.log('\n💡 Make sure ANTHROPIC_API_KEY is set in .env');
    }
  }
}

run();
