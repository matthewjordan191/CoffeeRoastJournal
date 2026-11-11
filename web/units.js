// Unit conversion and formatting. Data is stored in grams / °C / seconds
// (SPEC §3); these helpers convert only at the edges — display and input.

export const G_PER_OZ = 28.349523125;

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

/** Weight with its unit, for display: "225 g", "7.94 oz". */
export function formatWeight(g, unit) {
  const v = weightValue(g, unit);
  return v === "" ? "—" : `${v} ${unit}`;
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
