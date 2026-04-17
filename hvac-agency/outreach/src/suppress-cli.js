#!/usr/bin/env node
// Operator helper: add an email to the outreach suppression list. Consult inbound
// bounces and unsubscribe mailto replies and run `node src/suppress-cli.js <email> [reason]`
// to ensure we never contact that address again.
const { addSuppression, SUPPRESSION_FILE } = require("./suppression");

const [, , emailArg, ...reasonParts] = process.argv;

if (!emailArg) {
  console.error("Usage: node src/suppress-cli.js <email> [reason...]");
  console.error(`Suppression list: ${SUPPRESSION_FILE}`);
  process.exit(1);
}

const reason = reasonParts.join(" ").trim() || "manual";

(async () => {
  try {
    const added = await addSuppression(emailArg, reason);
    if (added) {
      console.log(`[Suppression] Added ${emailArg} (${reason})`);
    } else {
      console.log(`[Suppression] ${emailArg} was already suppressed — no change.`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
