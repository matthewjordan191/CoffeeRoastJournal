// Settings shape, defaults and validation, shared by every backend so the
// rules can't drift between localStorage and Firestore. See SPEC §3.4.

export const DEFAULT_SETTINGS = Object.freeze({
  weightUnit: "g",     // "g" | "oz"
  tempUnit: "F",       // "F" | "C"
  defaultBatchG: 225,  // grams (canonical)
  defaultFan: 9,       // 1–9
  defaultHeat: 1,      // 1–9
});

export const LIMITS = Object.freeze({
  batchG: { min: 50, max: 500 },
  control: { min: 1, max: 9 },
});

const CHECKS = {
  weightUnit: v => v === "g" || v === "oz",
  tempUnit: v => v === "F" || v === "C",
  defaultBatchG: v => Number.isFinite(v) && v >= LIMITS.batchG.min && v <= LIMITS.batchG.max,
  defaultFan: v => Number.isInteger(v) && v >= LIMITS.control.min && v <= LIMITS.control.max,
  defaultHeat: v => Number.isInteger(v) && v >= LIMITS.control.min && v <= LIMITS.control.max,
};

/** Field names in `s` that are invalid (empty array = valid). Unknown keys are invalid too. */
export function invalidSettingsFields(s) {
  return Object.keys(s).filter(k => !(k in CHECKS) || !CHECKS[k](s[k]));
}

/** Lenient read path: keep each stored field that is valid, default the rest. */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(CHECKS)) {
      if (k in raw && CHECKS[k](raw[k])) out[k] = raw[k];
    }
  }
  return out;
}
