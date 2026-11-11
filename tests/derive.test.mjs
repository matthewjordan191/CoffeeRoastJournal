// node --test   (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as d from "../web/derive.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ≈${expected}, got ${actual}`);

// A finished roast: charge 0, yellowing 4:30, FC 8:00, FC end 9:30, cool 10:00, cooled 13:30.
const roast = {
  id: "r1", beanId: "b1", chargedAt: new Date(2026, 10, 10, 18, 0).getTime(),
  greenG: 225, roastedG: 191.25, restDaysPlanned: 3, totalTimeS: 600,
  milestones: [
    { type: "charge", t: 0 }, { type: "yellowing", t: 270 }, { type: "fcStart", t: 480 },
    { type: "fcEnd", t: 570 }, { type: "cool", t: 600 }, { type: "coolingDone", t: 810 },
  ],
  controlEvents: [
    { t: 0, control: "fan", value: 9 }, { t: 0, control: "heat", value: 1 },
    { t: 60, control: "heat", value: 5 }, { t: 300, control: "fan", value: 7 },
    { t: 480, control: "heat", value: 3 },
    { t: 650, control: "fan", value: 9 }, // during cooling — must be ignored
  ],
};

test("stock: purchased − roasted, including the in-progress roast", () => {
  const bean = { id: "b1", purchases: [{ grams: 454, price: 12.5 }, { grams: 1000, price: null }] };
  const roasts = [{ beanId: "b1", greenG: 225 }, { beanId: "b2", greenG: 999 }];
  assert.equal(d.purchasedG(bean), 1454);
  assert.equal(d.roastedG("b1", roasts), 225);
  assert.equal(d.remainingStockG(bean, roasts), 1229);
  assert.equal(d.remainingStockG(bean, roasts, { beanId: "b1", greenG: 200 }), 1029);
  assert.equal(d.remainingStockG(bean, roasts, { beanId: "b2", greenG: 200 }), 1229, "other bean's live roast doesn't count");
  assert.equal(d.purchasedG({ id: "x" }), 0, "no purchases array");
});

test("stockStatus: out ≤ 0, low < one batch, else ok", () => {
  assert.equal(d.stockStatus(-5, 225), "out");
  assert.equal(d.stockStatus(0, 225), "out");
  assert.equal(d.stockStatus(224.9, 225), "low");
  assert.equal(d.stockStatus(225, 225), "ok");
});

test("prices and cost per roast", () => {
  const bean = { purchases: [{ grams: 454, price: 12.5 }, { grams: 1000, price: null }, { grams: 500, price: 10 }] };
  close(d.avgPricePerG(bean), 22.5 / 954);
  close(d.costPerRoast({ greenG: 225 }, bean), 225 * 22.5 / 954);
  assert.equal(d.avgPricePerG({ purchases: [{ grams: 100, price: null }] }), null);
  assert.equal(d.costPerRoast({ greenG: 225 }, { purchases: [] }), null);
  assert.equal(d.costPerRoast({ greenG: 225 }, null), null);
});

test("avgTastingScore over a bean's roasts only", () => {
  const roasts = [{ id: "r1", beanId: "b1" }, { id: "r2", beanId: "b2" }];
  const tastings = [{ roastId: "r1", score: 8 }, { roastId: "r1", score: 7 }, { roastId: "r2", score: 2 }, { roastId: "r1", score: null }];
  assert.equal(d.avgTastingScore("b1", roasts, tastings), 7.5);
  assert.equal(d.avgTastingScore("b3", roasts, tastings), null);
});

test("elapsedS is computed from timestamps", () => {
  assert.equal(d.elapsedS(1_000_000, 1_090_500), 90.5);
  assert.equal(d.elapsedS(1_000_000, 999_000), 0, "clock skew never goes negative");
  assert.equal(d.elapsedS(null, 5), null);
});

test("milestones, total time", () => {
  assert.equal(d.milestoneT(roast, "fcStart"), 480);
  assert.equal(d.milestoneT(roast.milestones, "fcEnd"), 570);
  assert.equal(d.milestoneT(roast, "sc"), null);
  assert.equal(d.totalTimeS(roast), 600);
  assert.equal(d.totalTimeS({ milestones: [{ type: "cool", t: 555 }] }), 555, "falls back to the cool milestone");
});

test("development time and ratio — finished and live", () => {
  assert.equal(d.developmentS(roast.milestones, 600), 120);
  close(d.developmentRatio(roast.milestones, 600), 20);
  // live: 60 s after first crack at 8:00 → 1:00 dev, 60/540 = 11.1 %
  assert.equal(d.developmentS(roast.milestones, 540), 60);
  close(d.developmentRatio(roast.milestones, 540), (60 / 540) * 100);
  assert.equal(d.developmentS(roast.milestones, 400), null, "before first crack");
  assert.equal(d.developmentS([{ type: "charge", t: 0 }], 600), null, "no first crack");
  assert.equal(d.developmentRatio(roast.milestones, null), null);
});

test("phaseTimes", () => {
  assert.deepEqual(d.phaseTimes(roast), { dryingS: 270, maillardS: 210, developmentS: 120 });
  assert.deepEqual(
    d.phaseTimes({ totalTimeS: 500, milestones: [{ type: "charge", t: 0 }, { type: "fcStart", t: 450 }] }),
    { dryingS: null, maillardS: null, developmentS: 50 });
});

test("cooling time and weight loss", () => {
  assert.equal(d.coolingS(roast), 210);
  assert.equal(d.coolingS({ milestones: [{ type: "cool", t: 600 }] }), null);
  close(d.weightLossPct(roast), 15);
  assert.equal(d.weightLossPct({ greenG: 225, roastedG: null }), null);
  assert.equal(d.weightLossPct({ greenG: 0, roastedG: 10 }), null, "no divide by zero");
});

test("timeAtSettings walks events up to cool and ignores cooling", () => {
  const r = d.timeAtSettings(roast);
  assert.deepEqual(r.fan, { 9: 300, 7: 300 });
  assert.deepEqual(r.heat, { 1: 60, 5: 420, 3: 120 });
  assert.deepEqual(r.pairs, { "9/1": 60, "9/5": 240, "7/5": 180, "7/3": 120 });
  const total = obj => Object.values(obj).reduce((a, b) => a + b, 0);
  assert.equal(total(r.fan), 600);
  assert.equal(total(r.heat), 600);
  assert.equal(total(r.pairs), 600);
  assert.equal(d.timeAtSettings({ milestones: [], controlEvents: [] }), null, "no cool time");
});

test("timeAtSettings: unsorted input and a change exactly at cool", () => {
  const r = d.timeAtSettings({
    totalTimeS: 100,
    controlEvents: [
      { t: 50, control: "heat", value: 7 }, { t: 0, control: "fan", value: 9 },
      { t: 0, control: "heat", value: 1 }, { t: 100, control: "fan", value: 5 },
    ],
  });
  assert.deepEqual(r.fan, { 9: 100 });
  assert.deepEqual(r.heat, { 1: 50, 7: 50 });
});

test("daysSinceRoast uses local calendar days", () => {
  const evening = { chargedAt: new Date(2026, 10, 10, 23, 30).getTime(), restDaysPlanned: 2 };
  assert.equal(d.daysSinceRoast(evening, new Date(2026, 10, 10, 23, 59).getTime()), 0);
  assert.equal(d.daysSinceRoast(evening, new Date(2026, 10, 11, 0, 5).getTime()), 1, "after midnight is day 1");
  assert.equal(d.daysSinceRoast(evening, new Date(2026, 10, 17, 9, 0).getTime()), 7);
  assert.equal(d.isRested(evening, new Date(2026, 10, 11, 12).getTime()), false);
  assert.equal(d.isRested(evening, new Date(2026, 10, 12, 8).getTime()), true);
  assert.equal(d.isRested({ chargedAt: evening.chargedAt, restDaysPlanned: null }, Date.now()), null);
  // across a month/year boundary
  assert.equal(d.daysSinceRoast({ chargedAt: new Date(2026, 11, 31, 20).getTime() }, new Date(2027, 0, 2, 7).getTime()), 2);
});

test("daysPostRoast between roast and tasting date", () => {
  assert.equal(d.daysPostRoast({ date: "2026-11-14" }, roast), 4);
  assert.equal(d.daysPostRoast({ date: "2026-11-10" }, roast), 0);
  assert.equal(d.daysPostRoast({ date: "" }, roast), null);
  assert.equal(d.daysPostRoast({ date: "2026-11-14" }, {}), null);
});

test("brewRatio", () => {
  assert.equal(d.brewRatio({ doseG: 15, waterG: 250 }), 250 / 15);
  assert.equal(d.brewRatio({ doseG: 18, waterG: 36 }), 2);
  assert.equal(d.brewRatio({ doseG: 0, waterG: 250 }), null);
  assert.equal(d.brewRatio({ doseG: 15, waterG: null }), null);
});
