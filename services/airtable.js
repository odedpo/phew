const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE = 'Users';

// Map between code field names and Airtable field names
const FIELD_MAP = {
  phone: 'Phone',
  state: 'State',
  rec_count: 'FreeRecsUsed',
  is_subscribed: 'SubscriptionStatus',
  past_activities: 'PastActivities',
  kids: 'Kids',
  zipcode: 'Zipcode',
  preferences: 'Preferences',
  created_at: 'CreatedAt',
  stripe_customer_id: 'StripeCustomerId',
  last_recommendations: 'Phone', // stored in memory only
  last_active: 'CreatedAt', // reuse CreatedAt
  stripe_session_id: 'StripeCustomerId' // reuse
};

// Convert code fields to Airtable fields
function toAirtable(fields) {
  const mapped = {};
  for (const [key, value] of Object.entries(fields)) {
    const airtableKey = FIELD_MAP[key] || key;
    mapped[airtableKey] = value;
  }
  return mapped;
}

// Convert Airtable fields to code fields
const REVERSE_MAP = {};
for (const [code, at] of Object.entries(FIELD_MAP)) {
  REVERSE_MAP[at] = code;
}

function fromAirtable(fields) {
  const mapped = {};
  for (const [key, value] of Object.entries(fields)) {
    mapped[key] = value; // keep original Airtable name too
    if (REVERSE_MAP[key]) {
      mapped[REVERSE_MAP[key]] = value; // add code name alias
    }
  }
  return mapped;
}

function sanitizePhone(phone) {
  return phone.replace(/[^+\\d]/g, '');
}

async function getUser(phone) {
  const clean = sanitizePhone(phone);
  const records = await base(TABLE).select({
    filterByFormula: \`{Phone} = '\${clean}'\`,
    maxRecords: 1
  }).firstPage();
  if (!records.length) return null;
  return { id: records[0].id, ...fromAirtable(records[0].fields) };
}

async function createUser(phone) {
  const clean = sanitizePhone(phone);
  const record = await base(TABLE).create({
    Phone: clean,
    State: 'ONBOARDING_ZIPCODE',
    FreeRecsUsed: 0,
    SubscriptionStatus: 'free',
    PastActivities: '[]',
    Kids: '[]',
    CreatedAt: new Date().toISOString()
  });
  return { id: record.id, ...fromAirtable(record.fields) };
}

async function updateUser(recordId, fields) {
  const mapped = toAirtable(fields);
  const record = await base(TABLE).update(recordId, mapped);
  return { id: record.id, ...fromAirtable(record.fields) };
}

async function getAllSubscribed() {
  const records = await base(TABLE).select({
    filterByFormula: \`{SubscriptionStatus} = 'active'\`
  }).all();
  return records.map(r => ({ id: r.id, ...fromAirtable(r.fields) }));
}

async function getOrCreateUser(phone) {
  let user = await getUser(phone);
  if (!user) user = await createUser(phone);
  return user;
}

module.exports = { getUser, createUser, updateUser, getAllSubscribed, getOrCreateUser };
