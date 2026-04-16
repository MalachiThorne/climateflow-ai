const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);
  `);
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
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
  const { rows } = await pool.query(
    "SELECT data FROM records WHERE id = $1 AND collection = $2",
    [id, collection]
  );
  if (rows.length === 0) return null;
  const updated = { ...rows[0].data, ...updates, updatedAt: new Date().toISOString() };
  await pool.query(
    "UPDATE records SET data = $1, updated_at = NOW() WHERE id = $2 AND collection = $3",
    [JSON.stringify(updated), id, collection]
  );
  return updated;
}

async function findRecord(collection, predicate) {
  const all = await readCollection(collection);
  return all.find(predicate) || null;
}

async function findRecords(collection, predicate) {
  const all = await readCollection(collection);
  return all.filter(predicate);
}

module.exports = { init, readCollection, addRecord, updateRecord, findRecord, findRecords };
