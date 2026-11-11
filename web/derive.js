// Derived values (SPEC §4). Pure functions over store records: nothing here
// is ever persisted, and nothing here touches the DOM or the store.

const sum = (items, pick) => items.reduce((total, x) => total + (Number(pick(x)) || 0), 0);

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

/** Mean of tasting scores for a bean's roasts; null without any scored tastings. */
export function avgTastingScore(beanId, roasts, tastings) {
  const roastIds = new Set(roasts.filter(r => r.beanId === beanId).map(r => r.id));
  const scores = tastings.filter(t => roastIds.has(t.roastId) && t.score != null).map(t => t.score);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
