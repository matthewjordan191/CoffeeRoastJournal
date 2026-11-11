// Roast setup (SPEC §2.1 step 1): bean, weights, conditions, starting
// fan/heat. Charge creates the in-progress roast and opens the live timer.
// With a plan ("Roast this again", §2.3) everything is pre-filled from the
// earlier roast, which then drives milestone targets and fan/heat prompts.
import { store, newId, LIMITS } from "../store/index.js";
import { goBack, navigate } from "../router.js";
import { h, icon, mount, subHeader, field, textInput, segmented, stepper, toast } from "../ui.js";
import { weightValue, toGrams, parseDecimal, formatWeight, formatClock, fToC } from "../units.js";
import { remainingStockG, milestoneT } from "../derive.js";
import { createActive, planChanges } from "../roast-session.js";

const PURPOSES = ["Espresso", "Filter", "Pour-over", "Omni", "French press", "Cold brew"];

export async function render(root, { planId = null } = {}) {
  if (await store.active.get()) {
    navigate("#/roast/live", { replace: true }); // only one roast at a time
    return;
  }
  const [allBeans, roasts, settings, plan] = await Promise.all([
    store.beans.list({ includeArchived: true }), store.roasts.list(), store.settings.get(),
    planId ? store.roasts.get(planId) : null,
  ]);
  // Archived beans are hidden from the picker — except the plan's own bean.
  const beans = allBeans.filter(b => !b.archived || b.id === plan?.beanId);
  const unit = settings.weightUnit;
  const tUnit = settings.tempUnit;
  const header = subHeader({
    title: plan ? "Roast this again" : "Start roast",
    subtitle: plan ? `Following ${plan.beanName}, ${new Date(plan.chargedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : null,
    backLabel: plan ? "Back" : "Roasts",
    onBack: () => goBack(plan ? `#/roasts/${encodeURIComponent(plan.id)}` : "#/roasts"),
  });
  if (planId && !plan) toast("That roast no longer exists — starting a normal roast.", { error: true });

  if (!beans.length) {
    mount(root, header,
      h("section", { class: "empty" },
        h("div", { class: "empty-icon" }, icon("beans")),
        h("h2", null, "Add a bean first"),
        h("p", null, "Roasts are logged against the green coffee you bought, so stock stays right."),
        h("a", { class: "btn btn-accent empty-cta", href: "#/beans/new" }, icon("plus"), "Add a bean")));
    return;
  }

  beans.sort((a, b) => a.name.localeCompare(b.name));
  const stock = new Map(beans.map(b => [b.id, remainingStockG(b, roasts)]));
  // Default to the bean roasted most recently, if it's still active.
  const lastRoast = roasts.slice().sort((a, b) => b.chargedAt - a.chargedAt)[0];
  const defaultBean = beans.find(b => b.id === (plan ?? lastRoast)?.beanId) ?? beans[0];

  const beanSelect = h("select", { class: "text-input" },
    beans.map(b => h("option", { value: b.id, selected: b.id === defaultBean.id },
      `${b.name}${b.archived ? " (archived)" : ""} — ${formatWeight(Math.max(0, stock.get(b.id)), unit)} left`)));
  const bean = field({ id: "setup-bean", label: "Bean", input: beanSelect });

  const weight = field({
    id: "setup-weight", label: "Green weight", suffix: unit,
    input: textInput({ inputmode: "decimal", value: weightValue(plan?.greenG ?? settings.defaultBatchG, unit) }),
  });
  const stockWarning = h("p", { class: "field-warning", role: "status" });
  weight.el.append(stockWarning);

  const ambient = field({
    id: "setup-ambient", label: "Ambient temperature", optional: true, suffix: `°${tUnit}`,
    input: textInput({ inputmode: "decimal" }),
  });
  const purpose = field({
    id: "setup-purpose", label: "Roasting for", optional: true,
    input: textInput({ list: "purpose-options", autocapitalize: "sentences", placeholder: "e.g. Espresso" }),
  });
  const rest = field({
    id: "setup-rest", label: "Planned rest", optional: true, suffix: "days",
    input: textInput({ inputmode: "numeric" }),
  });

  let extensionTube = true;
  const tube = segmented({
    name: "setup-tube", label: "Extension tube", value: "yes",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    onChange: v => { extensionTube = v === "yes"; },
  });

  // A plan's own starting settings (its t = 0 events), not the Settings defaults.
  const planStart = control => plan?.controlEvents.find(e => e.control === control && e.t === 0)?.value;
  let fan = planStart("fan") ?? settings.defaultFan;
  let heat = planStart("heat") ?? settings.defaultHeat;
  const fanStep = stepper({ id: "setup-fan", label: "Starting fan", value: fan, min: 1, max: 9, onChange: v => { fan = v; fanStep.set(v); } });
  const heatStep = stepper({ id: "setup-heat", label: "Starting heat", value: heat, min: 1, max: 9, onChange: v => { heat = v; heatStep.set(v); } });

  function checkStock() {
    const g = toGrams(parseDecimal(weight.input.value) ?? NaN, unit);
    const left = stock.get(beanSelect.value);
    const archived = beans.find(b => b.id === beanSelect.value)?.archived;
    stockWarning.textContent = [
      archived ? "This bean is archived." : "",
      Number.isFinite(g) && g > left ? `Only ${formatWeight(Math.max(0, left), unit)} of this bean left. Log a purchase if that's wrong.` : "",
    ].filter(Boolean).join(" ");
  }
  beanSelect.addEventListener("change", checkStock);
  weight.input.addEventListener("input", checkStock);
  checkStock();

  async function charge(e) {
    e.preventDefault();
    let ok = true;
    const g = toGrams(parseDecimal(weight.input.value) ?? NaN, unit);
    if (!(g >= LIMITS.batchG.min && g <= LIMITS.batchG.max)) {
      weight.setError(`Enter ${weightValue(LIMITS.batchG.min, unit)}–${weightValue(LIMITS.batchG.max, unit)} ${unit}.`);
      ok = false;
    }
    const amb = parseDecimal(ambient.input.value);
    const ambC = amb == null ? null : tUnit === "F" ? fToC(amb) : amb;
    if (Number.isNaN(amb) || (ambC != null && (ambC < -10 || ambC > 50))) {
      ambient.setError(tUnit === "F" ? "Enter °F, 14–122." : "Enter °C, −10–50.");
      ok = false;
    }
    const restDays = parseDecimal(rest.input.value);
    if (Number.isNaN(restDays) || (restDays != null && (!Number.isInteger(restDays) || restDays < 0 || restDays > 60))) {
      rest.setError("Enter whole days, 0–60.");
      ok = false;
    }
    if (!ok) { root.querySelector("[aria-invalid]")?.focus(); return; }

    const chosen = beans.find(b => b.id === beanSelect.value);
    const active = createActive({
      beanId: chosen.id, beanName: chosen.name, greenG: g,
      ambientC: ambC == null ? null : Math.round(ambC * 10) / 10,
      extensionTube, purpose: purpose.input.value.trim() || null,
      restDaysPlanned: restDays, fan, heat, planRoastId: plan?.id ?? null,
    }, Date.now(), newId());
    try {
      await store.active.save(active);
      navigate("#/roast/live", { replace: true }); // Back from the timer skips setup
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  const planCard = plan
    ? h("section", { class: "plan-card" },
        h("p", { class: "stock-card-label" }, "The plan"),
        h("p", { class: "plan-summary" },
          [["Yellowing", "yellowing"], ["FC", "fcStart"], ["Cool", "cool"]]
            .map(([l, t]) => milestoneT(plan, t) == null ? null : `${l} ${formatClock(milestoneT(plan, t))}`)
            .filter(Boolean).join(" · ")),
        h("p", { class: "field-hint" }, `${planChanges(plan).length} fan/heat changes — you'll get a prompt 15 s before each.`))
    : null;

  mount(root,
    header,
    planCard,
    h("form", { class: "form", novalidate: true, onsubmit: charge },
      h("div", { class: "card form-card" }, bean.el, weight.el),
      h("div", { class: "card" }, fanStep.el, heatStep.el, tube.el),
      h("div", { class: "card form-card" }, ambient.el, purpose.el, rest.el),
      h("datalist", { id: "purpose-options" }, PURPOSES.map(p => h("option", { value: p }))),
      h("button", { type: "submit", class: "btn btn-accent btn-block btn-charge" }, "Charge — start timer"),
      h("p", { class: "form-note center" }, "Tap Charge the moment the beans go in.")),
  );
}
