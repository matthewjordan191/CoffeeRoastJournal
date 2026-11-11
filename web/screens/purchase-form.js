// Add / edit one purchase of a bean: #/beans/<id>/purchase[/<pid>].
// Also exports purchaseFields(), reused for the "first purchase" block of
// the new-bean form.
import { store, newId } from "../store/index.js";
import { goBack } from "../router.js";
import { h, subHeader, field, textInput, toast, mount } from "../ui.js";
import { weightValue, toGrams, parseDecimal, todayISO } from "../units.js";

const MAX_PURCHASE_G = 100_000; // 100 kg: anything above is surely a typo

/** Supplier names already used, for the datalist. */
export function knownSuppliers(beans) {
  const names = beans.flatMap(b => (b.purchases ?? []).map(p => p.supplier?.trim())).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Supplier / date / amount / price fields.
 * `required`: false lets the whole block be left blank (new-bean form).
 * read() → { ok, empty, value: { supplier, date, grams, price } }.
 */
export function purchaseFields({ prefix, unit, purchase = null, suppliers = [], required = true }) {
  const listId = `${prefix}-suppliers`;
  const supplier = field({
    id: `${prefix}-supplier`, label: "Supplier", optional: true,
    input: textInput({ value: purchase?.supplier ?? "", list: listId, autocapitalize: "words", enterkeyhint: "next" }),
  });
  const date = field({
    id: `${prefix}-date`, label: "Purchase date",
    input: h("input", { type: "date", class: "text-input", value: purchase?.date ?? todayISO(), max: todayISO() }),
  });
  const grams = field({
    id: `${prefix}-amount`, label: "Green weight bought", suffix: unit,
    input: textInput({ inputmode: "decimal", value: purchase ? weightValue(purchase.grams, unit) : "", enterkeyhint: "next" }),
  });
  const price = field({
    id: `${prefix}-price`, label: "Price paid", optional: true, hint: "Total for this bag, in dollars",
    input: textInput({ inputmode: "decimal", value: purchase?.price != null ? purchase.price.toFixed(2) : "", enterkeyhint: "done" }),
  });
  const datalist = h("datalist", { id: listId }, suppliers.map(s => h("option", { value: s })));

  function read() {
    [supplier, date, grams, price].forEach(f => f.setError(""));
    const amountText = grams.input.value.trim();
    const priceText = price.input.value.trim().replace(/^\$/, "");
    const supplierText = supplier.input.value.trim();
    const empty = !amountText && !priceText && !supplierText;
    if (empty && !required) return { ok: true, empty: true };

    let ok = true;
    const g = toGrams(parseDecimal(amountText) ?? NaN, unit);
    if (!amountText) { grams.setError("Enter how much you bought."); ok = false; }
    else if (!(g > 0 && g <= MAX_PURCHASE_G)) { grams.setError(`Enter a weight above 0 ${unit}.`); ok = false; }

    const p = parseDecimal(priceText);
    if (Number.isNaN(p) || (p != null && p < 0)) { price.setError("Enter a dollar amount, like 24.50."); ok = false; }

    const d = date.input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { date.setError("Pick a date."); ok = false; }

    return {
      ok, empty: false,
      value: { supplier: supplierText, date: d, grams: g, price: p == null ? null : Math.round(p * 100) / 100 },
    };
  }

  return { fields: [supplier, date, grams, price], datalist, read };
}

export async function render(root, { beanId, purchaseId }) {
  const [bean, allBeans, settings] = await Promise.all([
    store.beans.get(beanId),
    store.beans.list({ includeArchived: true }),
    store.settings.get(),
  ]);
  const beanRoute = `#/beans/${encodeURIComponent(beanId)}`;
  const existing = purchaseId ? bean?.purchases?.find(p => p.id === purchaseId) : null;

  if (!bean || (purchaseId && !existing)) {
    mount(root, 
      subHeader({ title: "Not found", backLabel: "Back", onBack: () => goBack(bean ? beanRoute : "#/beans") }),
      h("p", { class: "muted-block" }, bean ? "This purchase may have been deleted." : "This bean may have been deleted."));
    return;
  }

  const form = purchaseFields({
    prefix: "purchase", unit: settings.weightUnit, purchase: existing,
    suppliers: knownSuppliers(allBeans), required: true,
  });

  async function onSubmit(e) {
    e.preventDefault();
    const result = form.read();
    if (!result.ok) {
      root.querySelector("[aria-invalid]")?.focus();
      return;
    }
    // Re-read so a change made elsewhere since this form opened isn't lost.
    const fresh = await store.beans.get(beanId);
    if (!fresh) { toast("This bean was deleted.", { error: true }); return; }
    const purchases = existing
      ? fresh.purchases.map(p => (p.id === existing.id ? { ...p, ...result.value } : p))
      : [...(fresh.purchases ?? []), { id: newId(), ...result.value }];
    try {
      await store.beans.save({ ...fresh, purchases });
      toast(existing ? "Purchase updated" : "Purchase added");
      goBack(beanRoute);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function onDelete() {
    if (!confirm("Delete this purchase? Remaining stock will drop by its weight.")) return;
    const fresh = await store.beans.get(beanId);
    try {
      await store.beans.save({ ...fresh, purchases: fresh.purchases.filter(p => p.id !== existing.id) });
      toast("Purchase deleted");
      goBack(beanRoute);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  mount(root, 
    subHeader({
      title: existing ? "Edit purchase" : "Add purchase",
      subtitle: bean.name,
      backLabel: "Cancel",
      onBack: () => goBack(beanRoute),
    }),
    h("form", { class: "form", novalidate: true, onsubmit: onSubmit },
      h("div", { class: "card form-card" }, form.fields.map(f => f.el)),
      form.datalist,
      h("button", { type: "submit", class: "btn btn-accent btn-block" }, existing ? "Save purchase" : "Add purchase"),
      existing
        ? h("button", { type: "button", class: "btn btn-block btn-danger", onclick: onDelete }, "Delete purchase")
        : null),
  );
}
