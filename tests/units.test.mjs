// node --test   (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClock } from "../web/units.js";

test("formatClock floors like a running clock", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(59.9), "0:59");
  assert.equal(formatClock(75.4), "1:15");
  assert.equal(formatClock(3725), "1:02:05");
  assert.equal(formatClock(-3), "0:00");
  assert.equal(formatClock(null), "—");
});

test("formatClock isn't fooled by float error in differences of 0.1 s times", () => {
  assert.equal(600.3 - 480.3 < 120, true, "the float problem is real: 119.99999999999994");
  assert.equal(formatClock(600.3 - 480.3), "2:00");
  assert.equal(formatClock(780.3 - 600.3), "3:00");
});

import { parseClock, formatDelta } from "../web/units.js";

test("parseClock: m:ss, decimals, h:mm:ss", () => {
  assert.equal(parseClock("7:40"), 460);
  assert.equal(parseClock("07:05"), 425);
  assert.equal(parseClock("7:40.5"), 460.5);
  assert.equal(parseClock("0:00"), 0);
  assert.equal(parseClock("1:02:05"), 3725);
  assert.equal(parseClock(" 10:00 "), 600);
});

test("parseClock: bare digits from the iPhone number pad read as m:ss", () => {
  assert.equal(parseClock("740"), 460);
  assert.equal(parseClock("45"), 45);
  assert.equal(parseClock("5"), 5);
  assert.equal(parseClock("1205"), 725);
});

test("parseClock: empty is null, junk is NaN", () => {
  assert.equal(parseClock(""), null);
  assert.equal(parseClock("   "), null);
  for (const bad of ["7:60", "770", "abc", "7:4:", "-1:00", "12345"]) assert.ok(Number.isNaN(parseClock(bad)), bad);
});

test("formatDelta", () => {
  assert.equal(formatDelta(12), "+0:12");
  assert.equal(formatDelta(-65.4), "−1:05");
  assert.equal(formatDelta(0.3), "±0:00");
  assert.equal(formatDelta(null), "—");
});
