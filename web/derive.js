// Derived values (SPEC §4). Pure functions over store records: nothing here
// is ever persisted, and nothing here touches the DOM or the store.
//
// Conventions: times are seconds from charge (milestone `t`), weights are
// grams, and any value whose inputs are missing comes back as null — never
// NaN — so callers can render "—" without special cases.

const DAY_MS = 86_400_000;
const sum = (items, pick) => items.reduce((total, x) => total + (Number(pick(x)) || 0), 0);
const isNum = v => typeof v === "number" && Number.isFinite(v);

// ---------------------------------------------------------------- stock

/** Total green coffee bought for a bean, in grams. */
export function purchasedG(bean) {
  return sum(bean.purchases ?? [], p => p.grams);
}

/** Green coffee roasted from a bean: saved roasts plus the in-progress roast, if it uses this bean. */
export function roastedG(beanId, roasts, activeRoast = null) {
  const saved = sum(roasts.filter(r => r.beanId === beanId), r => r.greenG);
  const live = activeRoast?.beanId === beanId ? Number(activeRoast.greenG) || 0 : 0;
  return saved + live;
}

/** Σ purchases − Σ roasted (SPEC §4). Can go negative if a purchase was never logged. */
export function remainingStockG(bean, roasts, activeRoast = null) {
  return purchasedG(bean) - roastedG(bean.id, roasts, activeRoast);
}

/** "out" at or below zero, "low" when less than one default batch remains, else "ok". */
export function stockStatus(remainingG, batchG) {
  if (remainingG <= 0) return "out";
  if (remainingG < batchG) return "low";
  return "ok";
}

/** Average price per gram over the purchases that have a price; null if none do. */
export function avgPricePerG(bean) {
  const priced = (bean.purchases ?? []).filter(p => p.price != null && p.grams > 0);
  const grams = sum(priced, p => p.grams);
  return grams > 0 ? sum(priced, p => p.price) / grams : null;
}

/** Approximate cost of a roast's green coffee, at the bean's average price per gram. */
export function costPerRoast(roast, bean) {
  const perG = bean ? avgPricePerG(bean) : null;
  return perG != null && isNum(roast?.greenG) ? perG * roast.greenG : null;
}

/** Mean of tasting scores for a bean's roasts; null without any scored tastings. */
export function avgTastingScore(beanId, roasts, tastings) {
  const roastIds = new Set(roasts.filter(r => r.beanId === beanId).map(r => r.id));
  const scores = tastings.filter(t => roastIds.has(t.roastId) && t.score != null).map(t => t.score);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

// ---------------------------------------------------------------- timing

/** Seconds since charge. Always computed from timestamps — never counted ticks. */
export function elapsedS(chargedAt, nowMs) {
  if (!isNum(chargedAt) || !isNum(nowMs)) return null;
  return Math.max(0, (nowMs - chargedAt) / 1000);
}

/** `t` of a milestone, from a roast or a bare milestones array; null if not recorded. */
export function milestoneT(roastOrMilestones, type) {
  const list = Array.isArray(roastOrMilestones) ? roastOrMilestones : roastOrMilestones?.milestones;
  const found = list?.find(m => m.type === type);
  return found && isNum(found.t) ? found.t : null;
}

/** Total roast time: charge → cool. */
export function totalTimeS(roast) {
  return isNum(roast?.totalTimeS) ? roast.totalTimeS : milestoneT(roast, "cool");
}

/**
 * Development time: first crack start → `endT`. For a finished roast pass
 * its total time; live, pass the current elapsed time.
 */
export function developmentS(milestones, endT) {
  const fc = milestoneT(milestones, "fcStart");
  if (fc == null || !isNum(endT) || endT < fc) return null;
  return endT - fc;
}

/** Development time ratio (DTR), as a percentage of `endT`. Works live too. */
export function developmentRatio(milestones, endT) {
  const dev = developmentS(milestones, endT);
  return dev != null && endT > 0 ? (dev / endT) * 100 : null;
}

/** Drying (charge → yellowing), Maillard (yellowing → FC), development (FC → cool). */
export function phaseTimes(roast) {
  const y = milestoneT(roast, "yellowing");
  const fc = milestoneT(roast, "fcStart");
  const end = totalTimeS(roast);
  const span = (a, b) => (a != null && b != null && b >= a ? b - a : null);
  return {
    dryingS: span(0, y),
    maillardS: span(y, fc),
    developmentS: span(fc, end),
  };
}

/** Cool → cooling finished. */
export function coolingS(roast) {
  const cool = milestoneT(roast, "cool");
  const done = milestoneT(roast, "coolingDone");
  return cool != null && done != null && done >= cool ? done - cool : null;
}

/** (green − roasted) / green × 100. */
export function weightLossPct(roast) {
  const { greenG, roastedG: out } = roast ?? {};
  if (!isNum(greenG) || greenG <= 0 || !isNum(out)) return null;
  return ((greenG - out) / greenG) * 100;
}

/**
 * Seconds spent at each fan value, each heat value, and each (fan, heat)
 * pair, from charge to cool. Events after cool (cooling) are ignored.
 * → { fan: { 9: 312.5, … }, heat: { … }, pairs: { "9/1": 120, … } }, or null
 * for a roast without a cool time.
 */
export function timeAtSettings(roast) {
  const end = totalTimeS(roast);
  if (end == null) return null;
  const events = (roast.controlEvents ?? [])
    .filter(e => isNum(e.t) && e.t <= end)
    .slice()
    .sort((a, b) => a.t - b.t);

  const result = { fan: {}, heat: {}, pairs: {} };
  const add = (bucket, key, s) => { if (s > 0) bucket[key] = (bucket[key] ?? 0) + s; };
  const current = { fan: null, heat: null };
  let from = 0;

  // Walk the change points; the settings in force between two points are
  // whatever the latest events before the first point set.
  const points = [...new Set([0, ...events.map(e => e.t), end])].sort((a, b) => a - b);
  let i = 0;
  for (const point of points) {
    const span = point - from;
    if (current.fan != null) add(result.fan, current.fan, span);
    if (current.heat != null) add(result.heat, current.heat, span);
    if (current.fan != null && current.heat != null) add(result.pairs, `${current.fan}/${current.heat}`, span);
    while (i < events.length && events[i].t === point) {
      current[events[i].control] = events[i].value;
      i++;
    }
    from = point;
  }
  return result;
}

// ---------------------------------------------------------------- days

const localDay = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const isoDay = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
};
// Math.round absorbs the 23/25-hour days around daylight-saving changes.
const daysBetween = (fromDayMs, toDayMs) => Math.round((toDayMs - fromDayMs) / DAY_MS);

/** Whole local calendar days since the roast: roasted last night, today is day 1. */
export function daysSinceRoast(roast, nowMs = Date.now()) {
  if (!isNum(roast?.chargedAt)) return null;
  return daysBetween(localDay(roast.chargedAt), localDay(nowMs));
}

/** Rested once days since roast ≥ planned rest days; null when no plan. */
export function isRested(roast, nowMs = Date.now()) {
  const days = daysSinceRoast(roast, nowMs);
  if (days == null || !isNum(roast.restDaysPlanned)) return null;
  return days >= roast.restDaysPlanned;
}

/** Days between the roast and a tasting (tasting.date is YYYY-MM-DD, local). */
export function daysPostRoast(tasting, roast) {
  const tastingDay = isoDay(tasting?.date);
  if (tastingDay == null || !isNum(roast?.chargedAt)) return null;
  return daysBetween(localDay(roast.chargedAt), tastingDay);
}

// ---------------------------------------------------------------- brewing

/** Water ÷ dose, shown as 1:x. */
export function brewRatio(tasting) {
  const { doseG, waterG } = tasting ?? {};
  return isNum(doseG) && doseG > 0 && isNum(waterG) && waterG > 0 ? waterG / doseG : null;
}
