const { createCipheriv, createDecipheriv, randomBytes } = require("crypto");

const ALGORITHM = "aes-256-gcm";

// Key rotation protocol:
//
//   1. Generate a new 32-byte hex key.
//   2. Deploy with TOKEN_ENCRYPTION_KEYS set to "<v2>:<hex2>,<v1>:<hex1>"
//      (newest first). TOKEN_ENCRYPTION_KEY is still read as the v1 fallback
//      so the transition doesn't break an incomplete deploy.
//   3. Run scripts/rotate-token-encryption.js (future work) which walks
//      calendar_tokens + gmail_tokens, decrypts with whatever version the
//      envelope declares, and re-encrypts with v2.
//   4. Once every envelope reads back as keyVersion "v2", retire v1 from
//      TOKEN_ENCRYPTION_KEYS.
//
// Envelopes minted before this change have no keyVersion field; decryptTokens
// treats them as v1 so pre-rotation records keep reading cleanly.
const DEFAULT_KEY_VERSION = "v1";

function parseKeyRegistry() {
  // Preferred shape: "v2:<hex>,v1:<hex>" — one line, newest first.
  // Fallback: legacy TOKEN_ENCRYPTION_KEY aliased to v1.
  const multi = process.env.TOKEN_ENCRYPTION_KEYS;
  const single = process.env.TOKEN_ENCRYPTION_KEY;
  const registry = new Map();
  if (typeof multi === "string" && multi.trim()) {
    for (const entry of multi.split(",")) {
      const [ver, hex] = entry.split(":").map((s) => (s || "").trim());
      if (!ver || !hex || hex.length !== 64) {
        throw new Error(`TOKEN_ENCRYPTION_KEYS entry malformed: "${entry}" (expect <version>:<64-hex>)`);
      }
      registry.set(ver, Buffer.from(hex, "hex"));
    }
  }
  if (typeof single === "string" && single.length === 64 && !registry.has(DEFAULT_KEY_VERSION)) {
    registry.set(DEFAULT_KEY_VERSION, Buffer.from(single, "hex"));
  }
  if (registry.size === 0) {
    throw new Error("TOKEN_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEYS must be set (64-char hex)");
  }
  return registry;
}

function currentKeyVersion(registry) {
  // Newest first: registry preserves insertion order, so take the first key.
  // Single-key deploys return "v1" — the default.
  return registry.keys().next().value;
}

function getKeyForVersion(registry, version) {
  const key = registry.get(version);
  if (!key) {
    throw new Error(`No key available for version ${version}. Retired too early?`);
  }
  return key;
}

function encryptTokens(tokens) {
  const registry = parseKeyRegistry();
  const version = currentKeyVersion(registry);
  const key = getKeyForVersion(registry, version);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(tokens);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: true,
    keyVersion: version,
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: tag.toString("hex"),
  };
}

function decryptTokens(envelope) {
  if (!envelope || !envelope.__enc) {
    throw new Error("Refusing to decrypt: token envelope is missing or not in encrypted format");
  }
  const registry = parseKeyRegistry();
  const version = envelope.keyVersion || DEFAULT_KEY_VERSION;
  const key = getKeyForVersion(registry, version);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(envelope.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

module.exports = { encryptTokens, decryptTokens };
