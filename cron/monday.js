const cron = require('node-cron');
const { getAllActive, updateUser } = require('../services/airtable');
const { getMondayFollowUp } = require('../services/claude');
const { sendSMS } = require('../services/twilio');

function startMondayCron() {
  // Every Monday at 3:00 PM ET
  cron.schedule('0 15 * * 1', async () => {
    console.log('[Monday Cron] Starting follow-up messages...');

    try {
      const users = await getAllActive();

      // Only message users who were active in the last 14 days
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const activeUsers = users.filter(u => {
        const lastActive = u.LastActiveDate || u.CreatedAt || '';
        return lastActive >= twoWeeksAgo;
      });

      console.log(`[Monday Cron] Sending to ${activeUsers.length} recently active users (${users.length} total)`);

      let sent = 0;
      let failed = 0;

      for (const user of activeUsers) {
        try {
          const message = await getMondayFollowUp(user);
          await sendSMS(user.Phone, message);

          // Set state to AWAITING_FEEDBACK so we know to process their reply
          await updateUser(user.id, { State: 'AWAITING_FEEDBACK' });

          sent++;
          // Delay between messages to avoid rate limits
          await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
          failed++;
          console.error(`[Monday Cron] Failed for ${user.Phone}:`, err.message);
        }
      }

      console.log(`[Monday Cron] Done — sent: ${sent}, failed: ${failed}`);

      // Reset AWAITING_FEEDBACK to ACTIVE after 24 hours
      // (in case they don't reply, we don't want them stuck)
      setTimeout(async () => {
        console.log('[Monday Cron] Resetting AWAITING_FEEDBACK states...');
        try {
          const stillWaiting = await require('../services/airtable').getAllActive();
          for (const u of stillWaiting) {
            if (u.State === 'AWAITING_FEEDBACK') {
              await updateUser(u.id, { State: 'ACTIVE' });
            }
          }
        } catch (err) {
          console.error('[Monday Cron] Reset failed:', err.message);
        }
      }, 24 * 60 * 60 * 1000); // 24 hours

    } catch (err) {
      console.error('[Monday Cron] Fatal error:', err);
    }
  }, {
    timezone: 'America/New_York'
  });

  console.log('Monday cron scheduled (every Monday 3pm ET)');
}

module.exports = { startMondayCron };
