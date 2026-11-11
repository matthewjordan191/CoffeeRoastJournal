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
  assert.deepEqual(r.milestones.slice(-2), [{ type: "cool", t: 600 }, { type: "coolingDone", t: 780 }], "SR800 cooling is always 3:00");
  for (const k of ["lastTap", "undo", "planRoastId", "status"]) assert.equal(k in r, false, `${k} dropped`);
  assert.equal(r.roastedG, null);
  assert.equal(r.photoId, null);
  assert.deepEqual(events(r, "heat"), [[0, 1], [500, 2]]);
});

// ---------------------------------------------------------------- roast this again

const plan = {
  milestones: [{ type: "charge", t: 0 }, { type: "fcStart", t: 460 }, { type: "cool", t: 600 }],
  controlEvents: [
    { t: 0, control: "fan", value: 9 }, { t: 0, control: "heat", value: 1 },
    { t: 300, control: "heat", value: 7 }, { t: 60, control: "heat", value: 5 },
    { t: 650, control: "fan", value: 9 },   // after cool: not a prompt
  ],
};

test("planChanges: after t = 0, before cool, in time order", () => {
  assert.deepEqual(s.planChanges(plan).map(c => [c.t, c.control, c.value]), [[60, "heat", 5], [300, "heat", 7]]);
  assert.deepEqual(s.planChanges(null), []);
});

test("promptState: prompt 15 s ahead, clear when made or 10 s after", () => {
  const changes = s.planChanges(plan);
  const a = fresh(9, 1);
  assert.deepEqual(s.promptState(changes, a, 40), { active: [], next: changes[0] });
  let st = s.promptState(changes, a, 46);
  assert.equal(st.active.length, 1);
  assert.equal(st.active[0].inS, 14);
  assert.equal(st.next, changes[1]);
  st = s.promptState(changes, a, 65);
  assert.equal(st.active[0].inS, -5, "still up just after the planned time");
  assert.equal(s.promptState(changes, a, 70).active.length, 0, "gone 10 s after");
  // made the change → cleared
  let b = s.tapControl(a, "heat", +4, at(55));
  assert.equal(s.promptState(changes, b, 56).active.length, 0);
  // already at the target value → never prompted
  b = s.tapControl(fresh(9, 1), "heat", +4, at(20));
  assert.equal(s.promptState(changes, b, 50).active.length, 0);
});

// ---------------------------------------------------------------- editing

const goodTimeline = () => ({
  milestones: [{ type: "charge", t: 0 }, { type: "yellowing", t: 270 }, { type: "fcStart", t: 480 }, { type: "cool", t: 600 }],
  controlEvents: [{ t: 0, control: "fan", value: 9 }, { t: 0, control: "heat", value: 1 }, { t: 60, control: "heat", value: 5 }],
  displayTemps: [{ t: 300, displayC: 200 }],
  notesLog: [{ t: 310, text: "smoke" }],
});

test("validateTimeline accepts a sound timeline", () => {
  assert.deepEqual(s.validateTimeline(goodTimeline()), []);
});

test("validateTimeline: cool required, milestones before cool and in order", () => {
  const keys = tl => s.validateTimeline(tl).map(e => e.key);
  let tl = goodTimeline(); tl.milestones = tl.milestones.filter(m => m.type !== "cool");
  assert.deepEqual(keys(tl), ["ms:cool"]);
  tl = goodTimeline(); tl.milestones.find(m => m.type === "fcStart").t = 650;
  assert.deepEqual(keys(tl), ["ms:fcStart"]);
  tl = goodTimeline(); tl.milestones.find(m => m.type === "fcStart").t = 200;
  assert.deepEqual(keys(tl), ["ms:fcStart"], "first crack before yellowing");
  tl = goodTimeline(); tl.milestones.push({ type: "sc", t: 470 });
  assert.deepEqual(keys(tl), ["ms:sc"], "second crack before first crack");
});

test("validateTimeline: starting settings, values, rows", () => {
  const keys = tl => s.validateTimeline(tl).map(e => e.key);
  let tl = goodTimeline(); tl.controlEvents = tl.controlEvents.filter(e => !(e.control === "heat" && e.t === 0));
  assert.deepEqual(keys(tl), ["start:heat"]);
  tl = goodTimeline(); tl.controlEvents[2].value = 10;
  assert.deepEqual(keys(tl), ["ctl:2"]);
  tl = goodTimeline(); tl.controlEvents[2].t = NaN;
  assert.deepEqual(keys(tl), ["ctl:2"]);
  tl = goodTimeline(); tl.notesLog[0].text = "  ";
  assert.deepEqual(keys(tl), ["note:0"]);
  tl = goodTimeline(); tl.displayTemps[0].displayC = NaN;
  assert.deepEqual(keys(tl), ["temp:0"]);
});

test("normalizeTimeline: sorted, totalTimeS from cool, cooling end kept at cool + 3:00", () => {
  const tl = goodTimeline();
  tl.controlEvents.reverse();
  tl.milestones.push({ type: "coolingDone", t: 999 });
  tl.milestones.find(m => m.type === "cool").t = 620;
  const r = s.normalizeTimeline(tl);
  assert.equal(r.totalTimeS, 620);
  assert.deepEqual(r.milestones.map(m => m.type), ["charge", "yellowing", "fcStart", "cool", "coolingDone"]);
  assert.equal(r.milestones.at(-1).t, 800);
  assert.deepEqual(r.controlEvents.map(e => e.t), [0, 0, 60]);
});
