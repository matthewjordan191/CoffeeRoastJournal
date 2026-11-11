// The live roast timer (SPEC §2.1–2.2). Full screen, used one-handed next
// to a hot roaster: big targets, nothing destructive on a single tap.
//
// State: the ActiveRoast from store.active (localStorage "roast-active").
// Every action goes through a pure function in roast-session.js and the
// result is written back immediately, so a reload or crash resumes exactly
// here. The clock is always now − chargedAt; the interval only repaints.
import { store } from "../store/index.js";
import { goBack, navigate } from "../router.js";
import { h, icon, mount, toast, confirmSheet, inputSheet, holdButton } from "../ui.js";
import { formatClock, formatWeight, formatTemp, parseDecimal, fToC } from "../units.js";
import { elapsedS, developmentS, developmentRatio, milestoneT } from "../derive.js";
import * as session from "../roast-session.js";
import { createWakeLock } from "../wakelock.js";

const CONTROL_LABEL = { fan: "Fan", heat: "Heat" };

export async function render(root) {
  let a = await store.active.get();
  if (!a) {
    navigate("#/roasts", { replace: true });
    return;
  }
  const settings = await store.settings.get();
  document.title = `Roasting ${a.beanName} · Roast Journal`;

  // Set while Cool/Discard hand off to another route, so the store
  // subscription below doesn't race them with its own redirect.
  let leaving = false;

  // ---- persistence: every change is written before the screen updates
  function apply(next) {
    if (leaving) return false;
    if (next === a) return false;
    a = next;
    store.active.save(a).catch(err => {
      // Loud on purpose: a failed write means a reload would lose this action.
      toast(`Not saved! ${err.message}`, { error: true });
    });
    refresh();
    return true;
  }

  // ---- wake lock
  const wakeBanner = h("p", { class: "wake-banner", role: "status", hidden: true });
  const lock = createWakeLock(state => {
    wakeBanner.hidden = state === "held";
    wakeBanner.textContent = {
      unsupported: "Screen may lock: this browser can't keep it awake. Tap the screen now and then, or set Auto-Lock to Never.",
      refused: "Screen may lock: keeping it awake was refused. Tap here to try again, or set Auto-Lock to Never.",
      lost: "Screen may lock: keep-awake was lost. Tap here to turn it back on.",
    }[state] ?? "";
  });
  wakeBanner.addEventListener("click", () => lock.retry());

  // ---- top bar
  const topBar = h("div", { class: "live-bar" },
    h("button", { type: "button", class: "back-btn", onclick: () => goBack("#/roasts") }, icon("back"), "Minimize"),
    h("button", { type: "button", class: "live-discard", onclick: discard }, "Discard"));

  const beanLine = h("p", { class: "live-bean" }, `${a.beanName} · ${formatWeight(a.greenG, settings.weightUnit)}`);

  // ---- clock + status
  const clock = h("p", { class: "live-clock", role: "timer", "aria-label": "Elapsed time" });
  const status = h("p", { class: "live-status", "aria-live": "polite" });

  // ---- fan / heat steppers
  function controlRow(control) {
    const value = h("span", { class: "ctl-value" });
    const pending = h("span", { class: "ctl-pending" }, "logging…");
    const dec = h("button", { type: "button", class: "ctl-btn", "aria-label": `${CONTROL_LABEL[control]} down` }, "−");
    const inc = h("button", { type: "button", class: "ctl-btn", "aria-label": `${CONTROL_LABEL[control]} up` }, "+");
    dec.addEventListener("click", () => apply(session.tapControl(a, control, -1, Date.now())));
    inc.addEventListener("click", () => apply(session.tapControl(a, control, +1, Date.now())));
    const row = h("div", { class: "ctl-row", role: "group", "aria-label": CONTROL_LABEL[control] },
      dec,
      h("div", { class: "ctl-center" }, h("span", { class: "ctl-label" }, CONTROL_LABEL[control]), value, pending),
      inc);
    return {
      row,
      update(now) {
        const v = session.currentValue(a, control);
        value.textContent = String(v);
        dec.disabled = v <= session.CONTROL_MIN;
        inc.disabled = v >= session.CONTROL_MAX;
        row.classList.toggle("merging", session.burstOpen(a, control, now));
      },
    };
  }
  const fanRow = controlRow("fan");
  const heatRow = controlRow("heat");

  // ---- milestones
  const milestoneButtons = session.LIVE_MILESTONES.map(({ type, label }) => {
    const time = h("span", { class: "ms-time" });
    const btn = h("button", { type: "button", class: "ms-btn" }, h("span", { class: "ms-label" }, label), time);
    btn.addEventListener("click", async () => {
      const pressedAt = Date.now();
      if (!session.hasMilestone(a, type)) {
        apply(session.markMilestone(a, type, pressedAt));
        return;
      }
      const recorded = formatClock(milestoneT(a, type));
      const ok = await confirmSheet({
        title: `Move ${label} to now?`,
        body: `It's recorded at ${recorded}. Now is ${formatClock(elapsedS(a.chargedAt, Date.now()))}.`,
        confirmLabel: "Move to now", cancelLabel: `Keep ${recorded}`,
      });
      if (ok) apply(session.moveMilestone(a, type, Date.now()));
    });
    return { type, btn, time };
  });

  // ---- temp / note / undo
  const tempBtn = h("button", { type: "button", class: "act-btn" }, "Temp");
  const noteBtn = h("button", { type: "button", class: "act-btn" }, "Note");
  const undoText = h("span", { class: "act-sub" });
  const undoBtn = h("button", { type: "button", class: "act-btn act-undo" }, h("span", null, "Undo"), undoText);

  tempBtn.addEventListener("click", async () => {
    const at = Date.now(); // the reading belongs to when you looked at the display
    const unit = settings.tempUnit;
    const [lo, hi] = unit === "F" ? [100, 550] : [40, 290];
    const text = await inputSheet({
      title: `Display temp at ${formatClock(elapsedS(a.chargedAt, at))}`,
      label: "SR800 display reading", hint: "The roaster's display temperature, not bean temperature.",
      suffix: `°${unit}`, inputmode: "decimal", saveLabel: "Log reading",
      validate: t => { const v = parseDecimal(t); return v >= lo && v <= hi ? null : `Enter ${lo}–${hi} °${unit}.`; },
    });
    if (text == null) return;
    const v = parseDecimal(text);
    apply(session.addTemp(a, unit === "F" ? fToC(v) : v, at));
  });
  noteBtn.addEventListener("click", async () => {
    const at = Date.now();
    const text = await inputSheet({
      title: `Note at ${formatClock(elapsedS(a.chargedAt, at))}`,
      label: "Note", multiline: true, placeholder: "e.g. chaff flying, smoke", saveLabel: "Add note",
    });
    if (text != null) apply(session.addNote(a, text, at));
  });
  undoBtn.addEventListener("click", () => {
    const what = session.undoPreview(a);
    if (what && apply(session.undo(a))) toast(`Undid ${describe(what)}`);
  });

  // ---- cool (hold) + discard
  const coolBtn = holdButton({
    label: "Hold to Cool", hint: "Keep holding to Cool", holdMs: 800, className: "cool-btn",
    onConfirm: pressStartMs => cool(pressStartMs),
  });

  async function cool(pressStartMs) {
    if (leaving) return;
    const roast = session.toRoast(a, pressStartMs);
    leaving = true;
    try {
      await store.active.finish(roast);
      lock.stop();
      toast(`Cooling — roast saved at ${formatClock(roast.totalTimeS)}`);
      navigate(`#/roasts/${encodeURIComponent(roast.id)}/finish`, { replace: true });
    } catch (err) {
      leaving = false;
      toast(err.message, { error: true });
    }
  }

  async function discard() {
    const ok = await confirmSheet({
      title: "Discard this roast?",
      body: "The timer stops and nothing is saved. This can't be undone.",
      confirmLabel: "Discard roast", cancelLabel: "Keep roasting", danger: true,
    });
    if (!ok || leaving) return;
    leaving = true;
    await store.active.discard();
    lock.stop();
    toast("Roast discarded");
    navigate("#/roasts", { replace: true });
  }

  // ---- repaint (cheap; runs every 250 ms and after every action)
  function refresh() {
    const now = Date.now();
    const elapsed = elapsedS(a.chargedAt, now);
    clock.textContent = formatClock(elapsed);

    const fc = milestoneT(a, "fcStart");
    if (fc != null) {
      const dev = developmentS(a.milestones, elapsed);
      const dtr = developmentRatio(a.milestones, elapsed);
      status.textContent = `Dev ${formatClock(dev)} · DTR ${dtr == null ? "—" : dtr.toFixed(1)}%`;
      status.classList.add("is-dev");
    } else {
      const last = session.lastMilestone(a);
      const lastTemp = a.displayTemps.at(-1);
      status.textContent = last
        ? `Last: ${session.LIVE_MILESTONES.find(m => m.type === last.type).label} at ${formatClock(last.t)}`
        : lastTemp ? `Display ${formatTemp(lastTemp.displayC, settings.tempUnit)} at ${formatClock(lastTemp.t)}` : "Charged — next: Yellowing";
      status.classList.remove("is-dev");
    }

    fanRow.update(now);
    heatRow.update(now);
    for (const m of milestoneButtons) {
      const t = milestoneT(a, m.type);
      m.btn.classList.toggle("done", t != null);
      m.time.textContent = t == null ? "Tap to mark" : formatClock(t);
    }
    const what = session.undoPreview(a);
    undoBtn.disabled = !what;
    undoText.textContent = what ? describe(what) : "Nothing yet";
  }

  function describe(what) {
    switch (what.kind) {
      case "control": return `${CONTROL_LABEL[what.control]} → ${what.value}`;
      case "milestone": return session.LIVE_MILESTONES.find(m => m.type === what.type).label;
      case "move": return `move ${session.LIVE_MILESTONES.find(m => m.type === what.type).label}`;
      case "temp": return `temp ${formatTemp(what.displayC, settings.tempUnit)}`;
      case "note": return "note";
      default: return "last action";
    }
  }

  mount(root,
    h("div", { class: "live" },
      topBar,
      wakeBanner,
      h("div", { class: "live-head" }, beanLine, clock, status),
      h("div", { class: "ctl-group" }, fanRow.row, heatRow.row),
      h("div", { class: "ms-grid" }, milestoneButtons.map(m => m.btn)),
      h("div", { class: "act-row" }, tempBtn, noteBtn, undoBtn),
      h("div", { class: "cool-wrap" }, coolBtn)));

  refresh();
  lock.start();
  const timer = setInterval(refresh, 250);
  const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
  document.addEventListener("visibilitychange", onVisible);
  // Any tap is a user gesture: use it to get keep-awake back if it was refused or lost.
  const onPointer = () => lock.retry();
  root.addEventListener("pointerdown", onPointer);

  // Another tab (or a store-level cleanup) changed the roast in progress.
  const unsubscribe = store.subscribe(async change => {
    if (leaving || (change.collection !== "active" && change.collection !== "*")) return;
    const latest = await store.active.get();
    if (!latest) { navigate("#/roasts", { replace: true }); return; }
    if (JSON.stringify(latest) !== JSON.stringify(a)) { a = latest; refresh(); }
  });

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    root.removeEventListener("pointerdown", onPointer);
    unsubscribe();
    lock.stop();
  };
}
