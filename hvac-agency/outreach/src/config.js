const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

module.exports = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    fromName: process.env.FROM_NAME || "ClimateFlow AI",
    fromEmail: process.env.FROM_EMAIL,
  },
  outreach: {
    dailySendLimit: parseInt(process.env.DAILY_SEND_LIMIT || "50", 10),
    delayBetweenEmails: parseInt(process.env.DELAY_BETWEEN_EMAILS_MS || "30000", 10),
  },
};
