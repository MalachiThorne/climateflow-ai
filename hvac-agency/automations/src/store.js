const { Pool } = require("pg");
const { randomUUID } = require("crypto");

// At 1000 clients, webhook load is highly concurrent. Size the pool to handle
// multiple simultaneous SMS/voice events without queuing at the DB layer.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : false,
  max: 20,                   // max concurrent DB connections
  idleTimeoutMillis: 30_000, // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail fast if pool is saturated
});

// Surface pool errors so they don't silently kill requests
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected error on idle client:", err.message);
});

async function init() {
  // Run each statement separately so index creation is independent
  const statements = [
    `CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Composite indexes: queries always filter by collection + one field.
    // A composite index is dramatically faster than two separate single-column indexes.
    `CREATE INDEX IF NOT EXISTS idx_records_coll_businessid
      ON records(collection, (data->>'businessId'))`,

    `CREATE INDEX IF NOT EXISTS idx_records_coll_phone
      ON records(collection, (data->>'phone'))`,

    `CREATE INDEX IF NOT EXISTS idx_records_coll_twilionumber
      ON records(collection, (data->>'twilioNumber'))`,

    `CREATE INDEX IF NOT EXISTS idx_records_coll_estimateid
      ON records(collection, (data->>'estimateId'))`,

    // Partial index: estimate cron only ever queries open estimates.
    // At 1000 clients with hundreds of estimates each, this avoids scanning closed/expired rows.
    `CREATE INDEX IF NOT EXISTS idx_records_open_estimates
      ON records(collection, (data->>'businessId'), (data->>'nextFollowUp'))
      WHERE data->>'status' = 'open'`,
  ];

  for (const sql of statements) {
    await pool.query(sql);
  }
}

function generateId() {
  return randomUUID();
}

async function healthCheck() {
  await pool.query("SELECT 1");
}

async function readCollection(collection) {
  const { rows } = await pool.query(
    "SELECT data FROM records WHERE collection = $1 ORDER BY created_at",
    [collection]
  );
  return rows.map((r) => r.data);
}

async function addRecord(collection, record) {
  const id = record.id || generateId();
  const entry = { id, createdAt: new Date().toISOString(), ...record };
  await pool.query(
    "INSERT INTO records (id, collection, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = $3, updated_at = NOW()",
    [id, collection, JSON.stringify(entry)]
  );
  return entry;
}

async function updateRecord(collection, id, updates) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT data FROM records WHERE id = $1 AND collection = $2 FOR UPDATE",
      [id, collection]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const updated = { ...rows[0].data, ...updates, updatedAt: new Date().toISOString() };
    await client.query(
      "UPDATE records SET data = $1, updated_at = NOW() WHERE id = $2 AND collection = $3",
      [JSON.stringify(updated), id, collection]
    );
    await client.query("COMMIT");
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// JSONB operator (->>) can't be parameterized, so field names are interpolated inline.
// Every field passed to a findRecord* helper MUST appear in this allow-list — the
// assertion below fails closed on unknown input, preventing SQL injection even if
// a caller accidentally forwards a user-controlled string.
const ALLOWED_FIELDS = new Set([
  "id",
  "businessId",
  "phone",
  "customerPhone",
  "twilioNumber",
  "estimateId",
  "status",
  "reviewId",
  "externalId",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "email",
  "ownerEmail",
  "verified",
  "expiresAt",
]);

function assertField(field) {
  if (typeof field !== "string" || !ALLOWED_FIELDS.has(field)) {
    throw new Error(`Unsupported field name in query: ${String(field)}`);
  }
  return field;
}

async function findRecordByField(collection, field, value) {
  assertField(field);
  const { rows } = await pool.query(
    `SELECT data FROM records WHERE collection = $1 AND data->>'${field}' = $2 LIMIT 1`,
    [collection, value]
  );
  return rows.length ? rows[0].data : null;
}

async function findRecordByFields(collection, fieldValues) {
  const entries = Object.entries(fieldValues);
  entries.forEach(([field]) => assertField(field));
  const clauses = entries.map(([field], i) => `data->>'${field}' = $${i + 2}`).join(" AND ");
  const values = [collection, ...entries.map(([, v]) => v)];
  const { rows } = await pool.query(
    `SELECT data FROM records WHERE collection = $1 AND ${clauses} LIMIT 1`,
    values
  );
  return rows.length ? rows[0].data : null;
}

async function findRecordsByField(collection, field, value) {
  assertField(field);
  const { rows } = await pool.query(
    `SELECT data FROM records WHERE collection = $1 AND data->>'${field}' = $2 ORDER BY created_at`,
    [collection, value]
  );
  return rows.map((r) => r.data);
}

async function findRecordsByFields(collection, fieldValues) {
  const entries = Object.entries(fieldValues);
  entries.forEach(([field]) => assertField(field));
  const clauses = entries.map(([field], i) => `data->>'${field}' = $${i + 2}`).join(" AND ");
  const values = [collection, ...entries.map(([, v]) => v)];
  const { rows } = await pool.query(
    `SELECT data FROM records WHERE collection = $1 AND ${clauses} ORDER BY created_at`,
    values
  );
  return rows.map((r) => r.data);
}

// Fallback JS-predicate scan — avoid in hot paths; fine for admin/one-off queries
async function findRecord(collection, predicate) {
  const all = await readCollection(collection);
  return all.find(predicate) || null;
}

async function findRecords(collection, predicate) {
  const all = await readCollection(collection);
  return all.filter(predicate);
}

// Atomic upsert-and-increment a numeric counter stored in data.count. Used for
// rate/cost caps where the read-then-write pattern would race. `initialData` is
// only written on insert; on conflict we just bump the counter and updated_at.
// Returns the resulting record data (with the post-increment count).
async function incrementCounter(collection, id, initialData = {}) {
  const seed = { id, count: 1, createdAt: new Date().toISOString(), ...initialData };
  const { rows } = await pool.query(
    `INSERT INTO records (id, collection, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       data = jsonb_set(
         records.data,
         '{count}',
         to_jsonb(COALESCE((records.data->>'count')::int, 0) + 1)
       ),
       updated_at = NOW()
     RETURNING data`,
    [id, collection, JSON.stringify(seed)]
  );
  return rows[0].data;
}

// Atomic "claim" — flips a boolean flag from falsy → true only if it is currently
// falsy, and returns the pre-claim snapshot. If two callers race, only one gets
// a non-null result; the other gets null. Used for single-shot operations like
// email verification provisioning.
async function claimRecord(collection, id, flagField) {
  assertField(flagField);
  const { rows } = await pool.query(
    `UPDATE records
     SET data = jsonb_set(data, ARRAY[$3]::text[], 'true'::jsonb),
         updated_at = NOW()
     WHERE id = $1 AND collection = $2
       AND COALESCE((data->>$3)::boolean, false) = false
     RETURNING data`,
    [id, collection, flagField]
  );
  return rows.length ? rows[0].data : null;
}

// Atomic delete-if-exists; returns the deleted record's data or null. Useful for
// single-use tokens (OAuth state, magic links) where "consume" must be atomic.
async function deleteRecord(collection, id) {
  const { rows } = await pool.query(
    "DELETE FROM records WHERE id = $1 AND collection = $2 RETURNING data",
    [id, collection]
  );
  return rows.length ? rows[0].data : null;
}

// Returns records whose `expiresAt` (stored as ms-since-epoch bigint-in-text) is
// earlier than the given threshold. Used by cleanup crons.
async function findExpiredRecords(collection, thresholdMs) {
  const { rows } = await pool.query(
    `SELECT data FROM records
     WHERE collection = $1
       AND data ? 'expiresAt'
       AND (data->>'expiresAt')::bigint < $2`,
    [collection, thresholdMs]
  );
  return rows.map((r) => r.data);
}

// Bulk delete by expiry — cheaper than find-then-delete when no per-record action is needed.
async function deleteExpiredRecords(collection, thresholdMs) {
  const { rowCount } = await pool.query(
    `DELETE FROM records
     WHERE collection = $1
       AND data ? 'expiresAt'
       AND (data->>'expiresAt')::bigint < $2`,
    [collection, thresholdMs]
  );
  return rowCount;
}

module.exports = {
  init,
  healthCheck,
  readCollection,
  addRecord,
  updateRecord,
  claimRecord,
  incrementCounter,
  deleteRecord,
  findRecord,
  findRecords,
  findRecordByField,
  findRecordByFields,
  findRecordsByField,
  findRecordsByFields,
  findExpiredRecords,
  deleteExpiredRecords,
};
