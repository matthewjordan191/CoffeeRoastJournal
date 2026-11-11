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
