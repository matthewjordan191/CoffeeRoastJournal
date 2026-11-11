// node --test   (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as s from "../web/roast-session.js";

const T0 = 1_800_000_000_000; // charge moment
const at = sec => T0 + sec * 1000;
const fresh = (fan = 9, heat = 1) =>
  s.createActive({ beanId: "b1", beanName: "Guji", greenG: 225, fan, heat }, T0, "roast-1");
const events = (a, control) => a.controlEvents.filter(e => e.control === control).map(e => [e.t, e.value]);

test("createActive: charge at 0 and starting settings at t = 0", () => {
  const a = fresh();
  assert.equal(a.chargedAt, T0);
  assert.deepEqual(a.milestones, [{ type: "charge", t: 0 }]);
  assert.deepEqual(s.currentSettings(a), { fan: 9, heat: 1 });
  assert.equal(a.extensionTube, true);
  assert.deepEqual(a.lastTap, { fan: null, heat: null });
  assert.deepEqual(a.undo, []);
});

test("tAt is derived from chargedAt, rounded to 0.1 s", () => {
  const a = fresh();
  assert.equal(s.tAt(a, at(61.26)), 61.3);
  assert.equal(s.tAt(a, T0 - 500), 0);
});

test("rapid taps within 2 s collapse into one event at the first tap's time", () => {
  let a = fresh();
  a = s.tapControl(a, "heat", +1, at(60));
  a = s.tapControl(a, "heat", +1, at(60.5));
  a = s.tapControl(a, "heat", +1, at(61.9));   // 1.4 s after the previous tap
  a = s.tapControl(a, "heat", +1, at(63.5));   // 1.6 s after the previous: window restarts per tap
  assert.deepEqual(events(a, "heat"), [[0, 1], [60, 5]]);
  assert.equal(a.undo.length, 1, "one undo step for the whole burst");
  assert.deepEqual(s.undoPreview(a), { kind: "control", control: "heat", value: 5, t: 60 });
});

test("taps more than 2 s apart are separate events", () => {
  let a = fresh();
  a = s.tapControl(a, "heat", +1, at(60));
  a = s.tapControl(a, "heat", +1, at(62.1));
  assert.deepEqual(events(a, "heat"), [[0, 1], [60, 2], [62.1, 3]]);
  assert.equal(a.undo.length, 2);
});

test("a burst that ends where it started logs nothing", () => {
  let a = fresh();
  a = s.tapControl(a, "fan", -1, at(100));
  a = s.tapControl(a, "fan", -1, at(100.4));
  a = s.tapControl(a, "fan", +1, at(100.9));
  a = s.tapControl(a, "fan", +1, at(101.3));
  assert.deepEqual(events(a, "fan"), [[0, 9]]);
  // …and tapping on again inside the window brings the event back at the burst's time
  a = s.tapControl(a, "fan", -1, at(102));
  assert.deepEqual(events(a, "fan"), [[0, 9], [100, 8]]);
});

test("fan and heat bursts merge independently, even interleaved", () => {
  let a = fresh();
  a = s.tapControl(a, "heat", +1, at(30));
  a = s.tapControl(a, "fan", -1, at(30.5));
  a = s.tapControl(a, "heat", +1, at(31));
  a = s.tapControl(a, "fan", -1, at(31.5));
  assert.deepEqual(events(a, "heat"), [[0, 1], [30, 3]]);
  assert.deepEqual(events(a, "fan"), [[0, 9], [30.5, 7]]);
  assert.deepEqual(a.controlEvents.map(e => e.t), [0, 0, 30, 30.5], "kept sorted by t");
});

test("controls clamp to 1–9; a tap at the limit changes nothing", () => {
  const a = fresh(9, 1);
  assert.equal(s.tapControl(a, "fan", +1, at(5)), a);
  assert.equal(s.tapControl(a, "heat", -1, at(5)), a);
});

test("a tap in the first instant doesn't collide with the t = 0 setting", () => {
  const a = s.tapControl(fresh(), "heat", +1, T0 + 20);
  assert.deepEqual(events(a, "heat"), [[0, 1], [0.1, 2]]);
});

test("undo reverts a whole burst, then the action before it", () => {
  let a = fresh();
  a = s.markMilestone(a, "yellowing", at(270));
  a = s.tapControl(a, "heat", +1, at(300));
  a = s.tapControl(a, "heat", +1, at(300.5));
  a = s.undo(a);
  assert.deepEqual(events(a, "heat"), [[0, 1]]);
  assert.equal(s.hasMilestone(a, "yellowing"), true);
  a = s.undo(a);
  assert.equal(s.hasMilestone(a, "yellowing"), false);
  assert.equal(s.undo(a), a, "nothing left to undo");
});

test("undo after a burst closes it: the next tap starts a new event", () => {
  let a = fresh();
  a = s.tapControl(a, "heat", +1, at(60));
  a = s.undo(a);
  a = s.tapControl(a, "heat", +1, at(60.5));
  assert.deepEqual(events(a, "heat"), [[0, 1], [60.5, 2]]);
});

test("milestones are recorded once; move re-times them", () => {
  let a = fresh();
  a = s.markMilestone(a, "fcStart", at(480));
  assert.equal(s.markMilestone(a, "fcStart", at(500)), a, "second tap does nothing");
  a = s.moveMilestone(a, "fcStart", at(495.04));
  assert.deepEqual(a.milestones.find(m => m.type === "fcStart"), { type: "fcStart", t: 495 });
  assert.deepEqual(s.undoPreview(a), { kind: "move", type: "fcStart" });
  assert.throws(() => s.markMilestone(a, "cool", at(600)), /Not a live milestone/);
  assert.equal(s.lastMilestone(a).type, "fcStart");
});

test("temps and notes are timestamped; blank or invalid input is ignored", () => {
  let a = fresh();
  a = s.addTemp(a, 204.4, at(400));
  a = s.addNote(a, "  smoke  ", at(410));
  assert.deepEqual(a.displayTemps, [{ t: 400, displayC: 204.4 }]);
  assert.deepEqual(a.notesLog, [{ t: 410, text: "smoke" }]);
  assert.equal(s.addNote(a, "   ", at(420)), a);
  assert.equal(s.addTemp(a, NaN, at(420)), a);
});

test("inputs are never mutated", () => {
  const a = fresh();
  const before = JSON.stringify(a);
  s.tapControl(a, "heat", +1, at(10));
  s.markMilestone(a, "yellowing", at(10));
  s.addNote(a, "x", at(10));
  assert.equal(JSON.stringify(a), before);
});

test("undo stack is capped", () => {
  let a = fresh();
  for (let i = 0; i < 40; i++) a = s.addNote(a, `n${i}`, at(i));
  assert.equal(a.undo.length, s.UNDO_LIMIT);
});

test("burstOpen reports the merge window", () => {
  const a = s.tapControl(fresh(), "heat", +1, at(10));
  assert.equal(s.burstOpen(a, "heat", at(11.9)), true);
  assert.equal(s.burstOpen(a, "heat", at(12.1)), false);
  assert.equal(s.burstOpen(a, "fan", at(10.5)), false);
});

test("toRoast: cool at the press start, totalTimeS, live-only fields dropped", () => {
  let a = fresh();
  a = s.markMilestone(a, "fcStart", at(480));
  a = s.tapControl(a, "heat", +1, at(500));
  const r = s.toRoast(a, at(600.04));
  assert.equal(r.id, "roast-1");
  assert.equal(r.totalTimeS, 600);
  assert.deepEqual(r.milestones.at(-1), { type: "cool", t: 600 });
  for (const k of ["lastTap", "undo", "planRoastId", "status"]) assert.equal(k in r, false, `${k} dropped`);
  assert.equal(r.roastedG, null);
  assert.equal(r.photoId, null);
  assert.deepEqual(events(r, "heat"), [[0, 1], [500, 2]]);
});
