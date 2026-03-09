/**
 * Local event discovery service
 *
 * Fetches real, current events near a zipcode for families.
 * Uses free public APIs and web scraping to find actual upcoming events.
 */

const https = require('https');

// ── Google Custom Search (free tier: 100 queries/day) ────────────────────────
// If GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX are set, use Google search.
// Otherwise, fall back to generating search-informed context for Claude.

async function fetchLocalEvents(zipcode, kidsAges = []) {
  const ageRange = kidsAges.length
    ? kidsAges.map(k => k.age || k).join(', ')
    : 'kids';

  // Build search queries for different event sources
  const queries = [
    `family events kids this weekend near ${zipcode}`,
    `free kids activities this weekend ${zipcode} 2026`,
    `children events ${zipcode} this Saturday Sunday`
  ];

  // Try PredictHQ-style free event search (or simple web fetch)
  const events = [];

  // Method 1: Try fetching from a community events source
  try {
    const results = await searchWeb(queries[0]);
    if (results) events.push(...results);
  } catch (err) {
    console.log('[Events] Web search unavailable:', err.message);
  }

  // If no external search works, generate context hints for Claude
  if (events.length === 0) {
    return generateSeasonalContext(zipcode, kidsAges);
  }

  return events;
}

// Simple HTTPS fetch helper
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Web search using Google Custom Search API (if configured)
async function searchWeb(query) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || !cx) return null;

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encoded}&num=5`;
    const raw = await httpGet(url);
    const data = JSON.parse(raw);

    if (data.items) {
      return data.items.map(item => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link
      }));
    }
  } catch (err) {
    console.log('[Events] Google search error:', err.message);
  }

  return null;
}

// ── Seasonal context generator ───────────────────────────────────────────────
// When we can't search the web, generate seasonal/contextual hints
// that make Claude's recommendations more timely and relevant.

function generateSeasonalContext(zipcode, kidsAges) {
  const now = new Date();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();

  const context = [];

  // Month-specific events and seasonal info for NJ/NY area
  const seasonalHints = {
    0: [ // January
      'Indoor play spaces are popular in winter',
      'Many museums have special winter break programming',
      'Ice skating rinks are typically open',
      'Check for MLK Day events if near the holiday'
    ],
    1: [ // February
      'Valentine\'s Day crafts and events at libraries',
      'Presidents\' Day weekend often has museum specials',
      'Indoor trampoline parks and climbing gyms',
      'Some nature centers do winter animal tracking programs'
    ],
    2: [ // March
      'Early spring — some outdoor activities resuming',
      'St. Patrick\'s Day parades and events in many NJ towns',
      'Spring break programming at museums and rec centers',
      'Maple sugaring events at nature centers',
      'Still cool enough that indoor backup plans are smart'
    ],
    3: [ // April
      'Cherry blossom viewing at Branch Brook Park',
      'Earth Day events and park cleanups (great for older kids)',
      'Outdoor farmers markets starting to open',
      'Spring festivals at many NJ parks',
      'Perfect hiking weather — trails are accessible again'
    ],
    4: [ // May
      'Memorial Day weekend events and parades',
      'Strawberry picking season starting',
      'Outdoor concerts and movie nights beginning',
      'Many pools and water parks opening for season',
      'Renaissance faires and outdoor festivals'
    ],
    5: [ // June
      'Summer camps and programs in full swing',
      'Splash pads and water parks fully open',
      'Blueberry and strawberry picking',
      'Free outdoor concerts in many towns',
      'Beach season officially started'
    ],
    6: [ // July
      'July 4th events and fireworks',
      'Peak beach and pool season',
      'Free summer movies in the park',
      'County fairs starting up',
      'Sprinkler parks and splash pads'
    ],
    7: [ // August
      'Last stretch of summer — make it count',
      'Back-to-school events and sales',
      'State fair season',
      'Great time for beach trips before crowds thin',
      'Peach and corn picking at local farms'
    ],
    8: [ // September
      'Apple picking season starting',
      'Fall festivals and harvest events',
      'Perfect hiking weather returning',
      'Many outdoor events for Labor Day weekend',
      'School is back — weekend activities extra important'
    ],
    9: [ // October
      'Pumpkin patches and corn mazes everywhere',
      'Halloween events, trick-or-treat trails',
      'Fall foliage hikes — peak color',
      'Oktoberfest events (family-friendly ones)',
      'Haunted hayrides (age-appropriate for older kids)'
    ],
    10: [ // November
      'Thanksgiving prep events and turkey trots',
      'Holiday light displays starting up',
      'Indoor activities as weather cools',
      'Black Friday family activities as alternative to shopping',
      'Some ski areas doing early season opening'
    ],
    11: [ // December
      'Holiday light shows and displays',
      'Santa events, tree lightings, winter markets',
      'Ice skating season in full swing',
      'Nutcracker performances and holiday shows',
      'Indoor play dates and holiday crafting'
    ]
  };

  const hints = seasonalHints[month] || [];

  return {
    type: 'seasonal_context',
    hints: hints,
    month: now.toLocaleString('en-US', { month: 'long' }),
    season: month >= 2 && month <= 4 ? 'spring' :
            month >= 5 && month <= 7 ? 'summer' :
            month >= 8 && month <= 10 ? 'fall' : 'winter'
  };
}

module.exports = { fetchLocalEvents, generateSeasonalContext };
