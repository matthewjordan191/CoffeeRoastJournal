// Live-roast state changes (SPEC §2.1–2.2, §3.2.1), as pure functions.
//
// Every function takes the ActiveRoast object plus the moment of the action
// (`nowMs`, epoch ms) and returns a NEW object; the input is never mutated,
// and an action that changes nothing returns the input itself. The screen
// persists whatever comes back. Times are always derived from `chargedAt`
// — there is no tick counting anywhere.

export const MERGE_MS = 2000;   // rapid fan/heat taps closer than this are one change
export const UNDO_LIMIT = 30;
export const CONTROL_MIN = 1;
export const CONTROL_MAX = 9;
export const COOLING_S = 180;  // the SR800's cool cycle is always 3:00

/** The milestones tapped during a roast, in display order. */
export const LIVE_MILESTONES = [
  { type: "yellowing", label: "Yellowing" },
  { type: "fcStart", label: "First crack" },
  { type: "fcEnd", label: "First crack end" },
  { type: "sc", label: "Second crack" },
];

export const ROAST_LEVELS = ["Cinnamon", "City", "City+", "Full City", "Full City+", "Vienna", "French"];

const clone = v => structuredClone(v);
const round1 = v => Math.round(v * 10) / 10;
const byT = (a, b) => a.t - b.t; // Array.prototype.sort is stable, so equal t keeps insertion order

/** Seconds from charge to `nowMs`, to 0.1 s, never negative. */
export function tAt(a, nowMs) {
  return Math.max(0, round1((nowMs - a.chargedAt) / 1000));
}

/**
 * New in-progress roast at Charge. `id` comes from the store (kept out of
 * here so this module stays pure).
 */
export function createActive(setup, nowMs, id) {
  return {
    id,
    beanId: setup.beanId,
    beanName: setup.beanName,
    greenG: setup.greenG,
    ambientC: setup.ambientC ?? null,
    extensionTube: setup.extensionTube ?? true,
    purpose: setup.purpose ?? null,
    restDaysPlanned: setup.restDaysPlanned ?? null,
    chargedAt: nowMs,
    milestones: [{ type: "charge", t: 0 }],
    controlEvents: [
      { t: 0, control: "fan", value: setup.fan },
      { t: 0, control: "heat", value: setup.heat },
    ],
    displayTemps: [],
    notesLog: [],
    planRoastId: setup.planRoastId ?? null,
    lastTap: { fan: null, heat: null },
    undo: [],
  };
}

// An undo entry snapshots everything an action can change, plus `what` —
// a description the screen turns into "Undo: Heat → 5".
function withUndo(a, what) {
  const entry = {
    what,
    milestones: clone(a.milestones),
    controlEvents: clone(a.controlEvents),
    displayTemps: clone(a.displayTemps),
    notesLog: clone(a.notesLog),
    lastTap: clone(a.lastTap),
  };
  return { ...a, undo: [...(a.undo ?? []), entry].slice(-UNDO_LIMIT) };
}

/** The setting in force for `control` (its latest event). */
export function currentValue(a, control) {
  let value = null;
  for (const e of a.controlEvents) if (e.control === control) value = e.value;
  return value;
}

export function currentSettings(a) {
  return { fan: currentValue(a, "fan"), heat: currentValue(a, "heat") };
}

/** Is a rapid-tap burst still open (taps would merge) for this control? */
export function burstOpen(a, control, nowMs) {
  const open = a.lastTap?.[control];
  return !!open && nowMs >= open.at && nowMs - open.at < MERGE_MS;
}

/**
 * Fan/heat − / + (SPEC §2.2). The first tap of a burst logs an event at its
 * own time; taps less than MERGE_MS after the previous tap on the same
 * control rewrite that event. A burst that ends where it started logs
 * nothing. Fan and heat bursts are independent.
 */
export function tapControl(a, control, delta, nowMs) {
  const current = currentValue(a, control);
  const next = Math.min(CONTROL_MAX, Math.max(CONTROL_MIN, current + delta));
  if (next === current) return a; // at a limit: nothing to log

  const lastTap = { fan: null, heat: null, ...a.lastTap };

  if (burstOpen(a, control, nowMs)) {
    const open = lastTap[control];
    let controlEvents = a.controlEvents.filter(e => !(e.control === control && e.t === open.t));
    if (next !== open.startValue) controlEvents = [...controlEvents, { t: open.t, control, value: next }].sort(byT);
    lastTap[control] = { ...open, at: nowMs };
    // Keep the burst's undo label in step with its value, if it's still the latest entry.
    const undo = (a.undo ?? []).slice();
    const top = undo[undo.length - 1];
    if (top?.what.kind === "control" && top.what.control === control && top.what.t === open.t) {
      undo[undo.length - 1] = { ...top, what: { ...top.what, value: next } };
    }
    return { ...a, controlEvents, lastTap, undo };
  }

  // New burst. Never share a `t` with another event of this control (e.g. a
  // tap in the first 50 ms would otherwise collide with the t = 0 setting).
  let t = tAt(a, nowMs);
  while (a.controlEvents.some(e => e.control === control && e.t === t)) t = round1(t + 0.1);
  const b = withUndo(a, { kind: "control", control, value: next, t });
  lastTap[control] = { at: nowMs, startValue: current, t };
  return { ...b, controlEvents: [...b.controlEvents, { t, control, value: next }].sort(byT), lastTap };
}

export function hasMilestone(a, type) {
  return a.milestones.some(m => m.type === type);
}

const TAPPABLE = new Set(LIVE_MILESTONES.map(m => m.type));

/** Record a milestone once. Already recorded → unchanged (use moveMilestone). */
export function markMilestone(a, type, nowMs) {
  if (!TAPPABLE.has(type)) throw new Error(`Not a live milestone: ${type}`);
  if (hasMilestone(a, type)) return a;
  const b = withUndo(a, { kind: "milestone", type });
  return { ...b, milestones: [...b.milestones, { type, t: tAt(a, nowMs) }].sort(byT) };
}

/** Re-time a recorded milestone to now ("Move First crack to now?"). */
export function moveMilestone(a, type, nowMs) {
  if (!TAPPABLE.has(type) || !hasMilestone(a, type)) return a;
  const b = withUndo(a, { kind: "move", type });
  const t = tAt(a, nowMs);
  return { ...b, milestones: b.milestones.map(m => (m.type === type ? { ...m, t } : m)).sort(byT) };
}

/** A typed SR800 display-temperature reading, in °C (convert before calling). */
export function addTemp(a, displayC, nowMs) {
  if (typeof displayC !== "number" || !Number.isFinite(displayC)) return a;
  const b = withUndo(a, { kind: "temp", displayC });
  return { ...b, displayTemps: [...b.displayTemps, { t: tAt(a, nowMs), displayC }].sort(byT) };
}

export function addNote(a, text, nowMs) {
  const clean = String(text ?? "").trim();
  if (!clean) return a;
  const b = withUndo(a, { kind: "note", text: clean });
  return { ...b, notesLog: [...b.notesLog, { t: tAt(a, nowMs), text: clean }].sort(byT) };
}

/** What Undo would revert, or null. */
export function undoPreview(a) {
  const top = a.undo?.[a.undo.length - 1];
  return top ? top.what : null;
}

/** Revert the last action (a whole merged burst counts as one). */
export function undo(a) {
  if (!a.undo?.length) return a;
  const stack = a.undo.slice();
  const entry = stack.pop();
  return {
    ...a,
    milestones: entry.milestones,
    controlEvents: entry.controlEvents,
    displayTemps: entry.displayTemps,
    notesLog: entry.notesLog,
    lastTap: entry.lastTap,
    undo: stack,
  };
}

/** The most recent milestone after charge, or null. */
export function lastMilestone(a) {
  const tapped = a.milestones.filter(m => m.type !== "charge");
  return tapped.length ? tapped.reduce((x, y) => (y.t >= x.t ? y : x)) : null;
}

/**
 * Cool: turn the in-progress roast into a finished Roast record (SPEC
 * §3.2). `coolPressMs` is when the Cool press *started*, so the hold needed
 * to confirm it doesn't add to the roast time. The SR800 always cools for
 * COOLING_S, so `coolingDone` is recorded right away as cool + 3:00.
 */
export function toRoast(a, coolPressMs) {
  const t = Math.max(tAt(a, coolPressMs), ...a.milestones.map(m => m.t));
  return {
    id: a.id,
    beanId: a.beanId,
    beanName: a.beanName,
    chargedAt: a.chargedAt,
    greenG: a.greenG,
    roastedG: null,
    ambientC: a.ambientC,
    extensionTube: a.extensionTube,
    purpose: a.purpose,
    restDaysPlanned: a.restDaysPlanned,
    milestones: [...clone(a.milestones), { type: "cool", t }, { type: "coolingDone", t: round1(t + COOLING_S) }],
    controlEvents: clone(a.controlEvents),
    displayTemps: clone(a.displayTemps),
    notesLog: clone(a.notesLog),
    totalTimeS: t,
    roastLevel: null,
    rating: null,
    notes: "",
    photoId: null,
  };
}

// ---------------------------------------------------------------- "Roast this again" (SPEC §2.3)

export const PROMPT_LEAD_S = 15;  // prompt this long before each planned change
export const PROMPT_HOLD_S = 10;  // …and keep it up this long after, unless it's done

/** The plan's fan/heat changes after t = 0 and before its Cool, in time order. */
export function planChanges(plan) {
  const cool = plan?.milestones?.find(m => m.type === "cool")?.t ?? Infinity;
  return (plan?.controlEvents ?? [])
    .filter(e => e.t > 0 && e.t < cool)
    .slice()
    .sort(byT);
}

/**
 * Which planned changes to prompt for right now.
 *   active: changes within [t − 15 s, t + 10 s) not yet made, each with
 *           `inS` = seconds until its planned time (negative once past)
 *   next:   the first change whose prompt hasn't started yet, or null
 * A change counts as made once the current setting equals its value inside
 * its prompt window.
 */
export function promptState(changes, a, elapsedS) {
  const active = [];
  let next = null;
  for (const c of changes) {
    const opens = c.t - PROMPT_LEAD_S;
    if (elapsedS < opens) { next ??= c; continue; }
    if (elapsedS >= c.t + PROMPT_HOLD_S) continue;
    if (currentValue(a, c.control) === c.value) continue;
    active.push({ ...c, inS: c.t - elapsedS });
  }
  return { active, next };
}

// ---------------------------------------------------------------- editing a saved roast

export const EDITABLE_MILESTONES = [...LIVE_MILESTONES, { type: "cool", label: "Cool" }];

/**
 * Check an edited or hand-entered timeline (SPEC §2.2 "recorded events can
 * be edited"; §5 manual log). Returns a list of { key, message }; empty
 * means valid. Keys: "ms:<type>", "ctl:<index>", "temp:<index>", "note:<index>".
 */
export function validateTimeline({ milestones, controlEvents, displayTemps = [], notesLog = [] }) {
  const errors = [];
  const t = type => milestones.find(m => m.type === type)?.t ?? null;
  const cool = t("cool");
  if (cool == null) errors.push({ key: "ms:cool", message: "Cool time is required." });
  else if (!(cool > 0)) errors.push({ key: "ms:cool", message: "Cool must be after charge." });
  for (const { type, label } of LIVE_MILESTONES) {
    const v = t(type);
    if (v == null) continue;
    if (!(v > 0)) errors.push({ key: `ms:${type}`, message: `${label} must be after charge.` });
    else if (cool != null && v > cool) errors.push({ key: `ms:${type}`, message: `${label} must be before Cool.` });
  }
  const order = [["yellowing", "fcStart"], ["fcStart", "fcEnd"], ["fcStart", "sc"]];
  for (const [a, b] of order) {
    if (t(a) != null && t(b) != null && t(b) <= t(a)) {
      const la = LIVE_MILESTONES.find(m => m.type === a).label;
      const lb = LIVE_MILESTONES.find(m => m.type === b).label;
      errors.push({ key: `ms:${b}`, message: `${lb} must be after ${la}.` });
    }
  }
  for (const control of ["fan", "heat"]) {
    if (!controlEvents.some(e => e.control === control && e.t === 0)) {
      errors.push({ key: `start:${control}`, message: `Starting ${control} is required.` });
    }
  }
  controlEvents.forEach((e, i) => {
    if (!Number.isInteger(e.value) || e.value < CONTROL_MIN || e.value > CONTROL_MAX) {
      errors.push({ key: `ctl:${i}`, message: "Setting must be 1–9." });
    } else if (e.t !== 0 && !(e.t > 0)) {
      errors.push({ key: `ctl:${i}`, message: "Enter a time after charge." });
    }
  });
  displayTemps.forEach((r, i) => {
    if (!(r.t >= 0)) errors.push({ key: `temp:${i}`, message: "Enter a time." });
    else if (!Number.isFinite(r.displayC)) errors.push({ key: `temp:${i}`, message: "Enter a temperature." });
  });
  notesLog.forEach((n, i) => {
    if (!(n.t >= 0)) errors.push({ key: `note:${i}`, message: "Enter a time." });
    else if (!String(n.text ?? "").trim()) errors.push({ key: `note:${i}`, message: "Enter the note, or delete it." });
  });
  return errors;
}

/**
 * Tidy an edited timeline into stored shape: sort everything by t, put the
 * charge milestone at 0, set totalTimeS from Cool, and keep coolingDone at
 * cool + COOLING_S (the SR800 always cools for 3:00).
 */
export function normalizeTimeline(roast) {
  const cool = roast.milestones.find(m => m.type === "cool")?.t ?? null;
  const milestones = [
    { type: "charge", t: 0 },
    ...roast.milestones.filter(m => m.type !== "charge" && m.type !== "coolingDone"),
  ];
  if (cool != null) milestones.push({ type: "coolingDone", t: round1(cool + COOLING_S) });
  return {
    ...roast,
    milestones: milestones.sort(byT),
    controlEvents: roast.controlEvents.slice().sort(byT),
    displayTemps: (roast.displayTemps ?? []).slice().sort(byT),
    notesLog: (roast.notesLog ?? []).slice().sort(byT),
    totalTimeS: cool,
  };
}
