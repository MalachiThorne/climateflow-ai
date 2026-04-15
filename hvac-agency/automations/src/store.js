const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "../data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readCollection(collection) {
  const filePath = getFilePath(collection);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeCollection(collection, data) {
  fs.writeFileSync(getFilePath(collection), JSON.stringify(data, null, 2));
}

function addRecord(collection, record) {
  const data = readCollection(collection);
  const entry = { id: Date.now().toString(), createdAt: new Date().toISOString(), ...record };
  data.push(entry);
  writeCollection(collection, data);
  return entry;
}

function updateRecord(collection, id, updates) {
  const data = readCollection(collection);
  const idx = data.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  data[idx] = { ...data[idx], ...updates, updatedAt: new Date().toISOString() };
  writeCollection(collection, data);
  return data[idx];
}

function findRecords(collection, predicate) {
  return readCollection(collection).filter(predicate);
}

function findRecord(collection, predicate) {
  return readCollection(collection).find(predicate) || null;
}

module.exports = { readCollection, writeCollection, addRecord, updateRecord, findRecords, findRecord };
