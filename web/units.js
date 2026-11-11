// Unit conversion and formatting. Data is stored in grams / °C / seconds
// (SPEC §3); these helpers convert only at the edges — display and input.

export const G_PER_OZ = 28.349523125;
export const G_PER_LB = 453.59237; // green coffee is usually priced per pound

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;

// "226.80" → "226.8", "8.00" → "8", but "100" stays "100".
const trimZeros = s => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

export function gramsTo(g, unit) {
  return unit === "oz" ? g / G_PER_OZ : g;
}

export function toGrams(value, unit) {
  return round(unit === "oz" ? value * G_PER_OZ : value, 1);
}

/** Weight as a bare number string for an input field, in the given unit. */
export function weightValue(g, unit) {
  if (g == null || !Number.isFinite(g)) return "";
  const v = gramsTo(g, unit);
  return trimZeros(v.toFixed(unit === "oz" ? 2 : 1));
}

/** Weight with its unit, for display: "225 g", "1,360 g", "7.94 oz". */
export function formatWeight(g, unit) {
  if (g == null || !Number.isFinite(g)) return "—";
  const v = gramsTo(g, unit);
  const text = v.toLocaleString("en-US", { maximumFractionDigits: unit === "oz" ? 2 : Math.abs(v) >= 100 ? 0 : 1 });
  return `${text} ${unit}`;
}

/** Seconds as a clock: 75.4 → "1:15", 3725 → "1:02:05". null → "—". */
export function formatClock(s) {
  if (s == null || !Number.isFinite(s)) return "—";
  // Floor (a running clock shows 0:59 until a full minute has passed), but
  // absorb float error first: 780.3 − 600.3 is 179.99999999999994, not 180.
  const total = Math.floor(Math.max(0, s) + 1e-6);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Signed difference as a clock: +12 → "+0:12", −65 → "−1:05", 0 → "±0:00". */
export function formatDelta(s) {
  if (s == null || !Number.isFinite(s)) return "—";
  const r = Math.round(s);
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${formatClock(Math.abs(r))}`;
}

/**
 * Parse a typed roast time to seconds. Accepts "7:40", "07:40", "7:40.5",
 * "1:02:05", and — because the iPhone number pad has no colon — bare
 * digits read as m:ss: "740" → 7:40, "45" → 0:45, "1205" → 12:05.
 * Returns null for empty input, NaN for anything else (incl. seconds ≥ 60).
 */
export function parseClock(text) {
  const s = String(text ?? "").trim();
  if (s === "") return null;
  let m = /^(\d+):([0-5]?\d)(?:\.(\d))?$/.exec(s);
  if (m) return +m[1] * 60 + +m[2] + (m[3] ? +m[3] / 10 : 0);
  m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(s);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = /^(\d{1,4})$/.exec(s);
  if (m) {
    const digits = m[1].padStart(3, "0");
    const sec = +digits.slice(-2);
    return sec < 60 ? +digits.slice(0, -2) * 60 + sec : NaN;
  }
  return NaN;
}

/** Dollars: "$12.50". */
export function formatMoney(n) {
  return n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`;
}

/** Today's local date as YYYY-MM-DD (not UTC — late evening must not become tomorrow). */
export function todayISO(d = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-11" → "Nov 11, 2026", read as a local date. */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "—";
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const cToF = c => c * 9 / 5 + 32;
export const fToC = f => round((f - 32) * 5 / 9, 2);

/** Temperature for display: "401°F" / "205°C". */
export function formatTemp(c, unit) {
  if (c == null || !Number.isFinite(c)) return "—";
  return `${Math.round(unit === "F" ? cToF(c) : c)}°${unit}`;
}

/** Parse user-typed decimals ("8", "7.5", "7,5"). null if empty, NaN if junk. */
export function parseDecimal(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (s === "") return null;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}
