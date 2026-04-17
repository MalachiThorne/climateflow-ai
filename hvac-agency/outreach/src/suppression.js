const fsp = require("fs/promises");
const path = require("path");

const SUPPRESSION_FILE = path.resolve(__dirname, "../data/suppressed.json");
const TMP_SUFFIX = ".tmp";

function normalize(email) {
  return String(email || "").trim().toLowerCase();
}

// Fail CLOSED on parse errors. Returning [] on corruption would silently re-enable
// sends to previously opted-out addresses, which is both a CAN-SPAM violation and
// a reputational / deliverability disaster. Better to halt the send job loudly.
async function readList() {
  try {
    const text = await fsp.readFile(SUPPRESSION_FILE, "utf-8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("suppression file is not a JSON array");
    }
    return parsed;
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw new Error(
      `[Suppression] Refusing to continue: unable to read ${SUPPRESSION_FILE} (${err.message}). ` +
      `Fix or restore the file before sending — a corrupted suppression list must NOT be treated as empty.`
    );
  }
}

// Serialize all mutation through a single promise chain so concurrent addSuppression
// calls within the same process can't race on the read-modify-write pattern. Outreach
// runs as a single-host batch tool, so cross-process locking is not required; we
// still use atomic rename below so a crash mid-write can't truncate the live file.
let writeChain = Promise.resolve();
function serialize(fn) {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

async function writeListAtomic(entries) {
  const dir = path.dirname(SUPPRESSION_FILE);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${SUPPRESSION_FILE}${TMP_SUFFIX}.${process.pid}.${Date.now()}`;
  await fsp.writeFile(tmp, JSON.stringify(entries, null, 2));
  await fsp.rename(tmp, SUPPRESSION_FILE);
}

async function isSuppressed(email) {
  const needle = normalize(email);
  if (!needle) return false;
  const list = await readList();
  return list.some((entry) => entry && entry.email === needle);
}

async function addSuppression(email, reason = "unspecified") {
  const needle = normalize(email);
  if (!needle) return false;
  return serialize(async () => {
    const list = await readList();
    if (list.some((entry) => entry && entry.email === needle)) return false;
    list.push({ email: needle, reason, addedAt: new Date().toISOString() });
    await writeListAtomic(list);
    return true;
  });
}

module.exports = { isSuppressed, addSuppression, SUPPRESSION_FILE };
