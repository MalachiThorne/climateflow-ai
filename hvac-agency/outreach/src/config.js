const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// CAN-SPAM (15 U.S.C. §7704) requires every commercial email to include:
//   (1) a clear opt-out mechanism (mailto is acceptable, must be honored within 10 business days)
//   (2) a valid physical postal address of the sender
// These are configured via env vars so the same codebase can be reused by other agencies.
const unsubscribeMailto = process.env.UNSUBSCRIBE_MAILTO;
const physicalAddress = process.env.PHYSICAL_ADDRESS;

if (!unsubscribeMailto || !physicalAddress) {
  // Fail fast: refuse to load the sender module without the two CAN-SPAM essentials.
  throw new Error(
    "Outreach config error: UNSUBSCRIBE_MAILTO and PHYSICAL_ADDRESS are required " +
      "(CAN-SPAM compliance). Set them in outreach/.env before running any campaign."
  );
}

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
  compliance: {
    unsubscribeMailto,
    unsubscribeUrl: process.env.UNSUBSCRIBE_URL || "",
    physicalAddress,
    senderName: process.env.FROM_NAME || "ClimateFlow AI",
  },
};
