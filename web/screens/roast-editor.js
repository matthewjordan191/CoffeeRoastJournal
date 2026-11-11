// Roast editor (SPEC §2.2 "recorded events can be edited", §5 manual log).
//   #/roasts/<id>/edit   adjust times, change values, delete events
//   #/roasts/log         backfill a past roast by typing its timeline
// Times are typed as m:ss; bare digits work too ("740" → 7:40) because the
// iPhone number pad has no colon. Untouched times keep their stored 0.1 s
// precision. Results/finish details live on the finish form.
import { store, LIMITS } from "../store/index.js";
import { goBack, navigate } from "../router.js";
import { h, mount, subHeader, field, textInput, segmented, toast, icon } from "../ui.js";
import { weightValue, toGrams, parseDecimal, parseClock, formatClock, fToC, cToF } from "../units.js";
import { EDITABLE_MILESTONES, validateTimeline, normalizeTimeline, CONTROL_MIN, CONTROL_MAX } from "../roast-session.js";

const pad = n => String(n).padStart(2, "0");
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const VALUES = Array.from({ length: CONTROL_MAX - CONTROL_MIN + 1 }, (_, i) => CONTROL_MIN + i);

/** A time box: shows m:ss, accepts "7:40" or "740", keeps the stored value if untouched. */
function timeBox(t, label) {
  const initial = t == null ? "" : formatClock(t);
  const input = textInput({ inputmode: "numeric", placeholder: "m:ss", value: initial, "aria-label": label, class: "time-input", enterkeyhint: "next" });
  input.addEventListener("blur", () => {
    const v = parseClock(input.value);
    if (v != null && Number.isFinite(v) && input.value !== initial) input.value = formatClock(v);
  });
  return {
    input,
    /** null = blank, NaN = unreadable, else seconds */
    read: () => (input.value === initial ? t : parseClock(input.value)),
  };
}

function valueSelect(value, label) {
  return h("select", { class: "text-input value-select", "aria-label": label },
    VALUES.map(v => h("option", { value: String(v), selected: v === value }, String(v))));
}

export async function render(root, { roastId }) {
  const isNew = !roastId;
  const [existing, beans, settings] = await Promise.all([
    isNew ? null : store.roasts.get(roastId),
    store.beans.list({ includeArchived: true }),
    store.settings.get(),
  ]);
  const unit = settings.weightUnit;
  const tUnit = settings.tempUnit;
  const backRoute = isNew ? "#/roasts" : `#/roasts/${encodeURIComponent(roastId)}`;
  const header = subHeader({
    title: isNew ? "Log a past roast" : "Edit roast",
    subtitle: isNew ? "Type the times from your notes." : existing?.beanName,
    backLabel: "Cancel", onBack: () => goBack(backRoute),
  });

  if (!isNew && !existing) {
    mount(root, header, h("p", { class: "muted-block" }, "This roast may have been deleted."));
    return;
  }
  const selectable = beans.filter(b => !b.archived || b.id === existing?.beanId).sort((a, b) => a.name.localeCompare(b.name));
  if (!selectable.length) {
    mount(root, header,
      h("section", { class: "empty" },
        h("h2", null, "Add a bean first"),
        h("p", null, "Roasts are logged against a bean so stock stays right."),
        h("a", { class: "btn btn-accent empty-cta", href: "#/beans/new" }, icon("plus"), "Add a bean")));
    return;
  }

  const draft = existing ?? {
    beanId: selectable[0].id, beanName: selectable[0].name,
    chargedAt: Date.now(), greenG: settings.defaultBatchG, roastedG: null,
    ambientC: null, extensionTube: true, purpose: null, restDaysPlanned: null,
    milestones: [{ type: "charge", t: 0 }],
    controlEvents: [{ t: 0, control: "fan", value: settings.defaultFan }, { t: 0, control: "heat", value: settings.defaultHeat }],
    displayTemps: [], notesLog: [], totalTimeS: null,
    roastLevel: null, rating: null, notes: "", photoId: null,
  };

  // ---------------- basics
  const beanSelect = h("select", { class: "text-input" },
    selectable.map(b => h("option", { value: b.id, selected: b.id === draft.beanId }, b.archived ? `${b.name} (archived)` : b.name)));
  const bean = field({ id: "ed-bean", label: "Bean", input: beanSelect });
  const when = field({
    id: "ed-when", label: "Charged at",
    input: h("input", { type: "datetime-local", class: "text-input", value: toLocalInput(draft.chargedAt), max: toLocalInput(Date.now()) }),
  });
  const green = field({ id: "ed-green", label: "Green weight", suffix: unit, input: textInput({ inputmode: "decimal", value: weightValue(draft.greenG, unit) }) });
  const ambient = field({
    id: "ed-ambient", label: "Ambient temperature", optional: true, suffix: `°${tUnit}`,
    input: textInput({ inputmode: "decimal", value: draft.ambientC == null ? "" : String(Math.round(tUnit === "F" ? cToF(draft.ambientC) : draft.ambientC)) }),
  });
  const purpose = field({ id: "ed-purpose", label: "Roasting for", optional: true, input: textInput({ value: draft.purpose ?? "", autocapitalize: "sentences" }) });
  const rest = field({ id: "ed-rest", label: "Planned rest", optional: true, suffix: "days", input: textInput({ inputmode: "numeric", value: draft.restDaysPlanned ?? "" }) });
  let tube = draft.extensionTube !== false;
  const tubeCtl = segmented({
    name: "ed-tube", label: "Extension tube", value: tube ? "yes" : "no",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    onChange: v => { tube = v === "yes"; },
  });

  // ---------------- milestones (blank = not recorded; Cool required)
  const msFields = EDITABLE_MILESTONES.map(({ type, label }) => {
    const box = timeBox(draft.milestones.find(m => m.type === type)?.t ?? null, label);
    const f = field({ id: `ed-ms-${type}`, label, optional: type !== "cool", input: box.input });
    return { type, label, box, f };
  });

  // ---------------- starting settings
  const startOf = control => draft.controlEvents.find(e => e.control === control && e.t === 0)?.value ?? settings[control === "fan" ? "defaultFan" : "defaultHeat"];
  const startFan = valueSelect(startOf("fan"), "Starting fan");
  const startHeat = valueSelect(startOf("heat"), "Starting heat");

  // ---------------- editable lists (fan/heat changes, temps, notes)
  function list({ items, makeRow, addLabel, empty }) {
    const ul = h("ul", { class: "edit-list" });
    const rows = [];
    const emptyEl = h("p", { class: "edit-empty" }, empty);
    const sync = () => { emptyEl.hidden = rows.length > 0; };
    const add = item => {
      const row = makeRow(item);
      const del = h("button", { type: "button", class: "row-del", "aria-label": `Delete ${row.describe()}` }, "×");
      const err = h("p", { class: "field-error row-error" });
      const li = h("li", { class: "edit-row" }, row.cells, del, err);
      const entry = { ...row, li, err, setError(m) { err.textContent = m || ""; li.classList.toggle("invalid", !!m); } };
      del.addEventListener("click", () => { rows.splice(rows.indexOf(entry), 1); li.remove(); sync(); });
      rows.push(entry);
      ul.append(li);
      sync();
      return entry;
    };
    items.forEach(add);
    const addBtn = h("button", { type: "button", class: "section-action add-row" }, icon("plus"), addLabel);
    addBtn.addEventListener("click", () => { add(null).focus(); });
    return { el: h("div", null, emptyEl, ul, addBtn), rows };
  }

  const changes = list({
    items: draft.controlEvents.filter(e => e.t > 0),
    addLabel: "Add fan/heat change",
    empty: "No changes after the start.",
    makeRow: e => {
      const box = timeBox(e?.t ?? null, "Time of change");
      const control = h("select", { class: "text-input control-select", "aria-label": "Fan or heat" },
        h("option", { value: "heat", selected: (e?.control ?? "heat") === "heat" }, "Heat"),
        h("option", { value: "fan", selected: e?.control === "fan" }, "Fan"));
      const value = valueSelect(e?.value ?? 5, "New setting");
      return {
        cells: [box.input, control, h("span", { class: "arrow", "aria-hidden": "true" }, "→"), value],
        describe: () => "change",
        focus: () => box.input.focus(),
        read: () => ({ t: box.read(), control: control.value, value: Number(value.value) }),
      };
    },
  });

  const [lo, hi] = tUnit === "F" ? [100, 550] : [40, 290];
  const temps = list({
    items: draft.displayTemps ?? [],
    addLabel: "Add display temp",
    empty: "No display-temperature readings.",
    makeRow: r => {
      const box = timeBox(r?.t ?? null, "Time of reading");
      const temp = textInput({ inputmode: "decimal", class: "temp-input", "aria-label": `Display temperature in °${tUnit}`,
        value: r ? String(Math.round(tUnit === "F" ? cToF(r.displayC) : r.displayC)) : "" });
      const initial = temp.value;
      return {
        cells: [box.input, h("span", { class: "input-wrap row-wrap" }, temp, h("span", { class: "suffix" }, `°${tUnit}`))],
        describe: () => "reading",
        focus: () => box.input.focus(),
        read: () => {
          if (r && temp.value === initial) return { t: box.read(), displayC: r.displayC }; // keep stored precision
          const v = parseDecimal(temp.value);
          const ok = v != null && v >= lo && v <= hi;
          return { t: box.read(), displayC: ok ? Math.round((tUnit === "F" ? fToC(v) : v) * 100) / 100 : NaN };
        },
      };
    },
  });

  const notesList = list({
    items: draft.notesLog ?? [],
    addLabel: "Add note",
    empty: "No timed notes.",
    makeRow: n => {
      const box = timeBox(n?.t ?? null, "Time of note");
      const text = textInput({ value: n?.text ?? "", "aria-label": "Note", autocapitalize: "sentences", class: "note-input" });
      return { cells: [box.input, text], describe: () => "note", focus: () => box.input.focus(), read: () => ({ t: box.read(), text: text.value.trim() }) };
    },
  });

  // ---------------- save
  async function save(e) {
    e.preventDefault();
    const fields = [bean, when, green, ambient, rest, ...msFields.map(m => m.f)];
    fields.forEach(f => f.setError(""));
    [changes, temps, notesList].forEach(l => l.rows.forEach(r => r.setError("")));
    const startErr = root.querySelector("#ed-start-error");
    startErr.textContent = "";
    let ok = true;
    const bad = (f, msg) => { f.setError(msg); ok = false; };

    const chargedAt = new Date(when.input.value).getTime();
    if (!Number.isFinite(chargedAt)) bad(when, "Pick the date and time.");
    else if (chargedAt > Date.now() + 60_000) bad(when, "That's in the future.");

    const g = toGrams(parseDecimal(green.input.value) ?? NaN, unit);
    if (!(g >= LIMITS.batchG.min && g <= LIMITS.batchG.max)) {
      bad(green, `Enter ${weightValue(LIMITS.batchG.min, unit)}–${weightValue(LIMITS.batchG.max, unit)} ${unit}.`);
    }
    const amb = parseDecimal(ambient.input.value);
    const ambC = amb == null ? null : tUnit === "F" ? fToC(amb) : amb;
    if (Number.isNaN(amb) || (ambC != null && (ambC < -10 || ambC > 50))) bad(ambient, tUnit === "F" ? "Enter °F, 14–122." : "Enter °C, −10–50.");
    const restDays = parseDecimal(rest.input.value);
    if (Number.isNaN(restDays) || (restDays != null && (!Number.isInteger(restDays) || restDays < 0 || restDays > 60))) bad(rest, "Enter whole days, 0–60.");

    const milestones = [{ type: "charge", t: 0 }];
    for (const m of msFields) {
      const t = m.box.read();
      if (t == null) continue;
      if (Number.isNaN(t)) { bad(m.f, "Use m:ss, like 7:40."); continue; }
      milestones.push({ type: m.type, t });
    }

    const controlEvents = [
      { t: 0, control: "fan", value: Number(startFan.value) },
      { t: 0, control: "heat", value: Number(startHeat.value) },
    ];
    const changeRows = changes.rows.map(r => ({ row: r, value: r.read() }));
    changeRows.forEach(({ row, value }) => {
      if (value.t == null || Number.isNaN(value.t) || value.t <= 0) { row.setError("Enter a time after charge, like 2:30."); ok = false; }
    });
    controlEvents.push(...changeRows.map(c => c.value));

    const tempRows = temps.rows.map(r => ({ row: r, value: r.read() }));
    tempRows.forEach(({ row, value }) => {
      if (value.t == null || Number.isNaN(value.t)) { row.setError("Enter a time, like 5:10."); ok = false; }
      else if (!Number.isFinite(value.displayC)) { row.setError(`Enter ${lo}–${hi} °${tUnit}.`); ok = false; }
    });
    const noteRows = notesList.rows.map(r => ({ row: r, value: r.read() }));
    noteRows.forEach(({ row, value }) => {
      if (value.t == null || Number.isNaN(value.t)) { row.setError("Enter a time, like 5:10."); ok = false; }
      else if (!value.text) { row.setError("Enter the note, or delete it."); ok = false; }
    });

    // Cross-field rules (Cool required, order, before Cool, …) from the pure
    // validator. Run them even when a field above already failed, so every
    // problem shows at once; a field keeps its first (more specific) error.
    const errors = validateTimeline({
      milestones, controlEvents,
      displayTemps: tempRows.map(r => r.value), notesLog: noteRows.map(r => r.value),
    });
    const hasError = el => !!el && el.textContent !== "";
    for (const err of errors) {
      ok = false;
      const [kind, ref] = err.key.split(":");
      if (kind === "ms") {
        const m = msFields.find(x => x.type === ref);
        if (m && !hasError(m.f.el.querySelector(".field-error"))) m.f.setError(err.message);
      } else if (kind === "ctl" || kind === "temp" || kind === "note") {
        const row = { ctl: changeRows[Number(ref) - 2], temp: tempRows[Number(ref)], note: noteRows[Number(ref)] }[kind]?.row;
        if (row && !hasError(row.err)) row.setError(err.message);
      } else {
        startErr.textContent = err.message;
      }
    }

    if (!ok) {
      (root.querySelector("[aria-invalid], .edit-row.invalid input") ?? root.querySelector(".field-error:not(:empty)"))?.focus?.();
      toast("Fix the highlighted fields.", { error: true });
      return;
    }

    const chosen = beans.find(b => b.id === beanSelect.value);
    const base = isNew ? draft : (await store.roasts.get(roastId)) ?? draft;
    const record = normalizeTimeline({
      ...base,
      beanId: chosen.id,
      // The name is a snapshot from roast time; refresh it only if the bean changed.
      beanName: chosen.id === base.beanId && !isNew ? base.beanName : chosen.name,
      chargedAt, greenG: g,
      ambientC: ambC == null ? null : Math.round(ambC * 10) / 10,
      extensionTube: tube,
      purpose: purpose.input.value.trim() || null,
      restDaysPlanned: restDays,
      milestones, controlEvents,
      displayTemps: tempRows.map(r => r.value),
      notesLog: noteRows.map(r => r.value),
    });
    if (record.roastedG != null && record.roastedG > g) record.roastedG = null; // can't weigh more than went in

    try {
      const saved = await store.roasts.save(record);
      if (isNew) {
        toast("Roast logged — now add the results");
        navigate(`#/roasts/${encodeURIComponent(saved.id)}/finish`, { replace: true });
      } else {
        toast("Saved");
        goBack(backRoute);
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  mount(root,
    header,
    h("form", { class: "form", novalidate: true, onsubmit: save },
      h("div", { class: "card form-card" }, bean.el, when.el, green.el),
      h("h2", { class: "section-title" }, "Milestones"),
      h("p", { class: "form-note" }, "Minutes:seconds from charge. Typing 740 means 7:40. Clear a time to remove that milestone."),
      h("div", { class: "card form-card ms-fields" }, msFields.map(m => m.f.el)),
      h("h2", { class: "section-title" }, "Fan & heat"),
      h("div", { class: "card form-card" },
        h("div", { class: "start-row" },
          h("label", { class: "field-label" }, "Starting fan", startFan),
          h("label", { class: "field-label" }, "Starting heat", startHeat)),
        h("p", { class: "field-error", id: "ed-start-error" }),
        changes.el),
      h("h2", { class: "section-title" }, "Display temps"),
      h("div", { class: "card form-card" }, temps.el),
      h("h2", { class: "section-title" }, "Timed notes"),
      h("div", { class: "card form-card" }, notesList.el),
      h("h2", { class: "section-title" }, "Conditions"),
      h("div", { class: "card" }, tubeCtl.el),
      h("div", { class: "card form-card" }, ambient.el, purpose.el, rest.el),
      h("button", { type: "submit", class: "btn btn-accent btn-block" }, isNew ? "Save and add results" : "Save changes")),
  );
}
