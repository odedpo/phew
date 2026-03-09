const cron = require('node-cron');
const { getAllSubscribed } = require('../services/airtable');
const { getProactiveMessage } = require('../services/claude');
const { sendSMS } = require('../services/twilio');

function startThursdayCron() {
  // Every Thursday at 4:00 PM ET
  cron.schedule('0 16 * * 4', async () => {
    console.log('[Thursday Cron] Starting proactive messages...');

    try {
      const subscribers = await getAllSubscribed();
      console.log(`[Thursday Cron] Sending to ${subscribers.length} subscribers`);

      let sent = 0;
      let failed = 0;

      for (const user of subscribers) {
        try {
          const message = await getProactiveMessage(user);
          await sendSMS(user.Phone, message);
          sent++;
          // Delay between messages to avoid Twilio rate limits
          await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
          failed++;
          console.error(`[Thursday Cron] Failed for ${user.Phone}:`, err.message);
        }
      }

      console.log(`[Thursday Cron] Done — sent: ${sent}, failed: ${failed}`);
    } catch (err) {
      console.error('[Thursday Cron] Fatal error:', err);
    }
  }, {
    timezone: 'America/New_York'
  });

  console.log('Thursday cron scheduled (every Thursday 4pm ET)');
}

module.exports = { startThursdayCron };
