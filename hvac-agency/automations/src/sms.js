const twilio = require("twilio");
const config = require("./config");

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

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
