const twilio = require("twilio");
const config = require("./config");

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

async function sendSMS(to, body) {
  const message = await twilioClient.messages.create({
    body,
    from: config.twilio.phoneNumber,
    to,
  });
  return message.sid;
}

module.exports = { sendSMS };
