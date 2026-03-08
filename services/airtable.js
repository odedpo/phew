const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE = 'Users';

// Sanitize phone to prevent formula injection
function sanitizePhone(phone) {
  return phone.replace(/[^+\d]/g, '');
}

async function getUser(phone) {
  const clean = sanitizePhone(phone);
  const records = await base(TABLE).select({
    filterByFormula: `{phone} = '${clean}'`,
    maxRecords: 1
  }).firstPage();
  if (!records.length) return null;
  return { id: records[0].id, ...records[0].fields };
}

async function createUser(phone) {
  const clean = sanitizePhone(phone);
  const record = await base(TABLE).create({
    phone: clean,
    state: 'ONBOARDING_ZIPCODE',
    rec_count: 0,
    is_subscribed: false,
    past_activities: '[]',
    kids: '[]',
    created_at: new Date().toISOString()
  });
  return { id: record.id, ...record.fields };
}

async function updateUser(recordId, fields) {
  const record = await base(TABLE).update(recordId, fields);
  return { id: record.id, ...record.fields };
}

async function getAllSubscribed() {
  const records = await base(TABLE).select({
    filterByFormula: `{is_subscribed} = TRUE()`
  }).all();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

async function getOrCreateUser(phone) {
  let user = await getUser(phone);
  if (!user) user = await createUser(phone);
  return user;
}

module.exports = { getUser, createUser, updateUser, getAllSubscribed, getOrCreateUser };
