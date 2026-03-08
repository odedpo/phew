const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendSMS(to, body) {
  // Split long messages at natural break points (SMS concatenation limit ~1600)
  const chunks = splitMessage(body, 1500);
  for (const chunk of chunks) {
    await client.messages.create({
      body: chunk,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
    // Small delay between multi-part messages to preserve order
    if (chunks.length > 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline or space near the limit
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = maxLength;

    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  return chunks;
}

module.exports = { sendSMS };
