const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE = 'Users';

function sanitizePhone(phone) {
  return phone.replace(/[^+\d]/g, '');
}

async function getUser(phone) {
  const clean = sanitizePhone(phone);
  const records = await base(TABLE).select({
    filterByFormula: `{Phone} = '${clean}'`,
    maxRecords: 1
  }).firstPage();
  if (!records.length) return null;
  return { id: records[0].id, ...records[0].fields };
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
    ConversationHistory: '[]',
    ActivityFeedback: '[]',
    LearningNotes: '',
    LastActiveDate: new Date().toISOString(),
    CreatedAt: new Date().toISOString()
  });
  return { id: record.id, ...record.fields };
}

async function updateUser(recordId, fields) {
  const record = await base(TABLE).update(recordId, fields);
  return { id: record.id, ...record.fields };
}

async function getAllSubscribed() {
  const records = await base(TABLE).select({
    filterByFormula: `{SubscriptionStatus} = 'active'`
  }).all();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

async function getAllActive() {
  // All users who have completed onboarding (ACTIVE or AWAITING_PAYMENT)
  const records = await base(TABLE).select({
    filterByFormula: `OR({State} = 'ACTIVE', {State} = 'AWAITING_PAYMENT')`
  }).all();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

async function getOrCreateUser(phone) {
  let user = await getUser(phone);
  if (!user) user = await createUser(phone);
  return user;
}

module.exports = { getUser, createUser, updateUser, getAllSubscribed, getAllActive, getOrCreateUser };
