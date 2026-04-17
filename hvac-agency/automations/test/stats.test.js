// Unit tests for stats.js pure date-math helpers.
// No DB, no network, no external services required.

const test = require("node:test");
const assert = require("node:assert/strict");

const { lastWeekWindow, lastMonthWindow } = require("../src/stats");

// ---------------------------------------------------------------------------
// lastWeekWindow
// ---------------------------------------------------------------------------

test("lastWeekWindow returns a 7-day Mon–Sun range", () => {
  const { since, until } = lastWeekWindow();

  // since must be a Monday (UTC day 1)
  assert.equal(since.getUTCDay(), 1, "since should be Monday");
  // until is the exclusive end: start of the following Monday (also day 1)
  // The half-open window [since, until) covers Mon through Sun inclusive.
  assert.equal(until.getUTCDay(), 1, "until should be the following Monday (exclusive end)");

  const msInDay = 24 * 60 * 60 * 1000;
  assert.equal(until - since, 7 * msInDay, "window should span exactly 7 days");
});

test("lastWeekWindow dates are midnight UTC", () => {
  const { since, until } = lastWeekWindow();
  assert.equal(since.getUTCHours(), 0);
  assert.equal(since.getUTCMinutes(), 0);
  assert.equal(since.getUTCSeconds(), 0);
  assert.equal(until.getUTCHours(), 0);
  assert.equal(until.getUTCMinutes(), 0);
  assert.equal(until.getUTCSeconds(), 0);
});

test("lastWeekWindow until is in the past (before now)", () => {
  const { until } = lastWeekWindow();
  assert.ok(until < new Date(), "until should be before now");
});

// ---------------------------------------------------------------------------
// lastMonthWindow
// ---------------------------------------------------------------------------

test("lastMonthWindow returns exactly one calendar month", () => {
  const { since, until } = lastMonthWindow();

  // until must be the 1st of the current month at midnight UTC
  const now = new Date();
  assert.equal(until.getUTCFullYear(), now.getUTCFullYear());
  assert.equal(until.getUTCMonth(), now.getUTCMonth());
  assert.equal(until.getUTCDate(), 1);

  // since must be the 1st of the month before until
  const expectedSinceMonth = (until.getUTCMonth() - 1 + 12) % 12;
  assert.equal(since.getUTCDate(), 1);
  assert.equal(since.getUTCMonth(), expectedSinceMonth);
});

test("lastMonthWindow since is strictly before until", () => {
  const { since, until } = lastMonthWindow();
  assert.ok(since < until, "since must be before until");
});

test("lastMonthWindow dates are midnight UTC", () => {
  const { since, until } = lastMonthWindow();
  assert.equal(since.getUTCHours(), 0);
  assert.equal(since.getUTCMinutes(), 0);
  assert.equal(since.getUTCSeconds(), 0);
  assert.equal(until.getUTCHours(), 0);
  assert.equal(until.getUTCMinutes(), 0);
  assert.equal(until.getUTCSeconds(), 0);
});

test("lastMonthWindow until is in the past (before now)", () => {
  const { until } = lastMonthWindow();
  assert.ok(until <= new Date(), "until should not be in the future");
});
