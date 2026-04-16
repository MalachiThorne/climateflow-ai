const twilio = require("twilio");
const config = require("./config");

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

// Defense against injected output: strip URLs and phone numbers from AI-generated SMS
// before we send it. Prevents a prompt-injected model from smuggling phishing links or
// alternate callback numbers into a message on our Twilio line. `allowedPhone` is the
// business's own published number, which is allowed through.
function scrubAIReply(text, allowedPhone = "") {
  if (!text) return "";
  const allowedDigits = String(allowedPhone).replace(/\D/g, "");
  const out = String(text)
    // Drop http(s)/www URLs outright
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    // Drop phone-ish patterns unless they match the business's own number
    .replace(/\+?\d[\d\s\-().]{8,}\d/g, (match) => {
      const digits = match.replace(/\D/g, "");
      if (!allowedDigits) return "";
      return digits.endsWith(allowedDigits.slice(-10)) ? match : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return out;
}

async function sendSMS(to, body, fromNumber) {
  const message = await twilioClient.messages.create({
    body,
    from: fromNumber || config.twilio.phoneNumber,
    to,
  });
  return message.sid;
}

async function provisionPhoneNumber(areaCode) {
  const available = await twilioClient.availablePhoneNumbers("US").local.list({
    areaCode,
    smsEnabled: true,
    voiceEnabled: true,
    limit: 1,
  });

  if (available.length === 0) {
    const fallback = await twilioClient.availablePhoneNumbers("US").local.list({
      smsEnabled: true,
      voiceEnabled: true,
      limit: 1,
    });
    if (fallback.length === 0) throw new Error("No phone numbers available");
    available.push(fallback[0]);
  }

  const purchased = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${config.server.webhookBaseUrl}/webhooks/sms`,
    smsMethod: "POST",
    voiceUrl: `${config.server.webhookBaseUrl}/webhooks/voice/status`,
    voiceMethod: "POST",
    statusCallback: `${config.server.webhookBaseUrl}/webhooks/voice/status`,
    statusCallbackMethod: "POST",
  });

  return {
    phoneNumber: purchased.phoneNumber,
    sid: purchased.sid,
    friendlyName: purchased.friendlyName,
  };
}

module.exports = { sendSMS, provisionPhoneNumber };
