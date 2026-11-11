// Settings (SPEC §3.4, §5). Every change saves immediately through the store.
import { store, LIMITS, DEFAULT_SETTINGS } from "../store/index.js";
import { h, screenHeader, section, segmented, stepper, toast } from "../ui.js";
import { weightValue, toGrams, parseDecimal, formatWeight } from "../units.js";

export const title = "Settings";

export async function render(root) {
  let s = await store.settings.get();

  async function save(patch) {
    try {
      s = await store.settings.save(patch);
      sync();
      toast("Saved");
    } catch (err) {
      sync(); // snap controls back to what's actually stored
      toast(err.message, { error: true });
    }
  }

  // ---- Units
  const weight = segmented({
    name: "weight-unit", label: "Weight", value: s.weightUnit,
    options: [{ value: "g", label: "Grams" }, { value: "oz", label: "Ounces" }],
    onChange: v => save({ weightUnit: v }),
  });
  const temp = segmented({
    name: "temp-unit", label: "Temperature", value: s.tempUnit,
    options: [{ value: "F", label: "°F" }, { value: "C", label: "°C" }],
    onChange: v => save({ tempUnit: v }),
  });

  // ---- Batch weight: typed in the current unit, stored in grams
  const batchInput = h("input", {
    id: "batch-weight", type: "text", inputmode: "decimal", autocomplete: "off",
    enterkeyhint: "done", "aria-describedby": "batch-hint batch-error",
  });
  const batchSuffix = h("span", { class: "suffix", "aria-hidden": "true" });
  const batchError = h("span", { class: "field-error", id: "batch-error", role: "alert" });
  const batchWrap = h("div", { class: "input-wrap" }, batchInput, batchSuffix);

  function commitBatch() {
    const v = parseDecimal(batchInput.value);
    const unit = s.weightUnit;
    const g = v == null || Number.isNaN(v) ? NaN : toGrams(v, unit);
    if (!(g >= LIMITS.batchG.min && g <= LIMITS.batchG.max)) {
      batchError.textContent =
        `Enter ${weightValue(LIMITS.batchG.min, unit)}–${weightValue(LIMITS.batchG.max, unit)} ${unit}`;
      batchWrap.classList.add("invalid");
      batchInput.setAttribute("aria-invalid", "true");
      return;
    }
    clearBatchError();
    if (g !== s.defaultBatchG) save({ defaultBatchG: g });
    else batchInput.value = weightValue(s.defaultBatchG, unit); // tidy "225.0" → "225"
  }
  function clearBatchError() {
    batchError.textContent = "";
    batchWrap.classList.remove("invalid");
    batchInput.removeAttribute("aria-invalid");
  }
  batchInput.addEventListener("change", commitBatch);
  batchInput.addEventListener("keydown", e => { if (e.key === "Enter") batchInput.blur(); });

  const batchRow = h("div", { class: "row" },
    h("div", { class: "row-text" },
      h("label", { class: "row-label", for: "batch-weight" }, "Batch weight"),
      h("span", { class: "row-hint", id: "batch-hint" }, "Pre-fills green weight"),
      batchError),
    batchWrap,
  );

  const fan = stepper({
    id: "default-fan", label: "Starting fan", hint: "At charge",
    value: s.defaultFan, min: LIMITS.control.min, max: LIMITS.control.max,
    onChange: v => save({ defaultFan: v }),
  });
  const heat = stepper({
    id: "default-heat", label: "Starting heat", hint: "At charge",
    value: s.defaultHeat, min: LIMITS.control.min, max: LIMITS.control.max,
    onChange: v => save({ defaultHeat: v }),
  });

  // ---- Data on this device
  const counts = h("span", { class: "row-hint" });
  async function refreshCounts() {
    const [b, r, t] = await Promise.all([
      store.beans.list({ includeArchived: true }), store.roasts.list(), store.tastings.list(),
    ]);
    counts.textContent = `${b.length} beans · ${r.length} roasts · ${t.length} tastings`;
  }

  const resetBtn = h("button", {
    type: "button", class: "btn btn-quiet",
    onclick: () => {
      const d = DEFAULT_SETTINGS;
      const summary = `${d.weightUnit === "g" ? "grams" : "ounces"}, °${d.tempUnit}, ` +
        `${formatWeight(d.defaultBatchG, d.weightUnit)} batch, fan ${d.defaultFan}, heat ${d.defaultHeat}`;
      if (confirm(`Reset settings to defaults?\n\n${summary}`)) save({ ...DEFAULT_SETTINGS });
    },
  }, "Reset to defaults");

  function sync() {
    weight.set(s.weightUnit);
    temp.set(s.tempUnit);
    if (document.activeElement !== batchInput) {
      batchInput.value = weightValue(s.defaultBatchG, s.weightUnit);
      clearBatchError();
    }
    batchSuffix.textContent = s.weightUnit;
    fan.set(s.defaultFan);
    heat.set(s.defaultHeat);
  }
  sync();
  await refreshCounts();

  root.append(
    screenHeader(title),
    section("Units", weight.el, temp.el),
    section("Roast defaults", batchRow, fan.el, heat.el),
    section("Account",
      h("div", { class: "row" },
        h("div", { class: "row-text" },
          h("span", { class: "row-label" }, "Not signed in"),
          h("span", { class: "row-hint" },
            "Google sign-in and cloud sync come with the Firestore backend. For now, data stays on this device.")))),
    section("Data",
      h("div", { class: "row" },
        h("div", { class: "row-text" },
          h("span", { class: "row-label" }, "Stored on this device"),
          counts)),
      h("div", { class: "row" }, resetBtn)),
  );

  // Another tab (or, later, a sync) changed data: reflect it here.
  return store.subscribe(async change => {
    if (change.collection === "settings" || change.collection === "*") {
      s = await store.settings.get();
      sync();
    }
    if (change.collection !== "settings") refreshCounts();
  });
}
