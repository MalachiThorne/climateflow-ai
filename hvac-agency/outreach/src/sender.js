const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const LOG_FILE = path.resolve(__dirname, "../data/send_log.json");

function getTransporter() {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
}

function readLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
}

function writeLog(entries) {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

function hasBeenSent(email, templateKey) {
  const log = readLog();
  return log.some((entry) => entry.email === email && entry.templateKey === templateKey);
}

function todaySendCount() {
  const log = readLog();
  const today = new Date().toISOString().split("T")[0];
  return log.filter((entry) => entry.sentAt.startsWith(today)).length;
}

async function sendEmail(to, subject, body, templateKey) {
  if (hasBeenSent(to, templateKey)) {
    console.log(`[Sender] Skipping ${to} — already sent ${templateKey}`);
    return { skipped: true };
  }

  if (todaySendCount() >= config.outreach.dailySendLimit) {
    console.log(`[Sender] Daily limit reached (${config.outreach.dailySendLimit})`);
    return { limitReached: true };
  }

  const transporter = getTransporter();

  const htmlBody = body
    .split("\n\n")
    .map((p) => `<p style="margin: 0 0 16px 0; line-height: 1.6;">${p}</p>`)
    .join("");

  const info = await transporter.sendMail({
    from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
    to,
    subject,
    text: body,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        ${htmlBody}
      </div>
    `,
  });

  const logEntry = {
    email: to,
    subject,
    templateKey,
    messageId: info.messageId,
    sentAt: new Date().toISOString(),
  };

  const log = readLog();
  log.push(logEntry);
  writeLog(log);

  console.log(`[Sender] Sent "${subject}" to ${to}`);
  return { sent: true, messageId: info.messageId };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { sendEmail, hasBeenSent, todaySendCount, sleep };
