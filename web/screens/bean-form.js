// Add / edit a bean: #/beans/new, #/beans/<id>/edit.
// The new-bean form also takes an optional first purchase.
import { store, newId } from "../store/index.js";
import { goBack, navigate } from "../router.js";
import { h, subHeader, field, textInput, toast, mount } from "../ui.js";
import { parseDecimal } from "../units.js";
import { purchaseFields, knownSuppliers } from "./purchase-form.js";

const PROCESS_SUGGESTIONS = ["Washed", "Natural", "Honey", "Anaerobic", "Wet-hulled", "Semi-washed"];

const EMPTY_BEAN = {
  name: "", origin: "", region: "", producer: "", variety: "", process: "",
  altitudeM: null, cropYear: null, moisturePct: null,
  purchases: [], notes: "", archived: false,
};

export async function render(root, { beanId }) {
  const [existing, allBeans, settings] = await Promise.all([
    beanId ? store.beans.get(beanId) : null,
    store.beans.list({ includeArchived: true }),
    store.settings.get(),
  ]);
  const isNew = !beanId;
  const detailRoute = beanId ? `#/beans/${encodeURIComponent(beanId)}` : "#/beans";

  if (!isNew && !existing) {
    mount(root, 
      subHeader({ title: "Bean not found", backLabel: "Beans", onBack: () => goBack("#/beans") }),
      h("p", { class: "muted-block" }, "This bean may have been deleted."));
    return;
  }
  const bean = existing ?? EMPTY_BEAN;

  const text = (id, label, value, extra = {}) =>
    field({ id, label, optional: id !== "bean-name", input: textInput({ value: value ?? "", autocapitalize: "words", enterkeyhint: "next", ...extra }) });
  const num = (id, label, value, { suffix, hint, mode = "numeric" } = {}) =>
    field({ id, label, optional: true, suffix, hint, input: textInput({ inputmode: mode, value: value ?? "", enterkeyhint: "next" }) });

  const name = text("bean-name", "Name", bean.name, { placeholder: "e.g. Ethiopia Guji Hambela" });
  const origin = text("bean-origin", "Origin", bean.origin, { placeholder: "Country" });
  const region = text("bean-region", "Region", bean.region);
  const producer = text("bean-producer", "Producer", bean.producer, { placeholder: "Farm, estate or co-op" });
  const variety = text("bean-variety", "Variety", bean.variety, { placeholder: "e.g. Bourbon, Caturra" });
  const process = text("bean-process", "Process", bean.process, { list: "process-options" });
  const altitude = num("bean-altitude", "Altitude", bean.altitudeM, { suffix: "m", hint: "Put a range in notes" });
  const cropYear = num("bean-crop-year", "Crop year", bean.cropYear);
  const moisture = num("bean-moisture", "Moisture", bean.moisturePct, { suffix: "%", mode: "decimal" });
  const notes = field({
    id: "bean-notes", label: "Notes", optional: true,
    input: h("textarea", { class: "text-input", rows: "4", value: bean.notes ?? "" }),
  });

  const usedProcesses = allBeans.map(b => b.process?.trim()).filter(Boolean);
  const processList = h("datalist", { id: "process-options" },
    [...new Set([...PROCESS_SUGGESTIONS, ...usedProcesses])].map(p => h("option", { value: p })));

  const firstPurchase = isNew
    ? purchaseFields({ prefix: "first", unit: settings.weightUnit, suppliers: knownSuppliers(allBeans), required: false })
    : null;

  function readOptionalNumber(f, { integer, min, max, message }) {
    const v = parseDecimal(f.input.value);
    if (v == null) return { ok: true, value: null };
    if (Number.isNaN(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      f.setError(message);
      return { ok: false };
    }
    return { ok: true, value: v };
  }

  async function onSubmit(e) {
    e.preventDefault();
    [name, altitude, cropYear, moisture].forEach(f => f.setError(""));
    let ok = true;

    const nameValue = name.input.value.trim();
    if (!nameValue) { name.setError("Give the bean a name."); ok = false; }

    const thisYear = new Date().getFullYear();
    const alt = readOptionalNumber(altitude, { integer: true, min: 0, max: 3500, message: "Enter metres, 0–3500." });
    const year = readOptionalNumber(cropYear, { integer: true, min: 1990, max: thisYear + 1, message: `Enter a year, 1990–${thisYear + 1}.` });
    const moist = readOptionalNumber(moisture, { integer: false, min: 0, max: 30, message: "Enter a percentage, 0–30." });
    ok = ok && alt.ok && year.ok && moist.ok;

    const purchase = firstPurchase?.read();
    if (purchase && !purchase.ok) ok = false;

    if (!ok) {
      root.querySelector("[aria-invalid]")?.focus();
      return;
    }

    const record = {
      ...bean,
      name: nameValue,
      origin: origin.input.value.trim(),
      region: region.input.value.trim(),
      producer: producer.input.value.trim(),
      variety: variety.input.value.trim(),
      process: process.input.value.trim(),
      altitudeM: alt.value,
      cropYear: year.value,
      moisturePct: moist.value,
      notes: notes.input.value.trim(),
    };
    if (isNew) {
      record.purchases = purchase && !purchase.empty ? [{ id: newId(), ...purchase.value }] : [];
    } else {
      // Purchases and archived are edited elsewhere; keep the stored ones.
      const fresh = await store.beans.get(beanId);
      if (!fresh) { toast("This bean was deleted.", { error: true }); return; }
      record.purchases = fresh.purchases;
      record.archived = fresh.archived;
    }

    try {
      const saved = await store.beans.save(record);
      toast(isNew ? "Bean added" : "Saved");
      // New: replace the form in history, so Back from the detail goes to the list.
      if (isNew) navigate(`#/beans/${encodeURIComponent(saved.id)}`, { replace: true });
      else goBack(detailRoute);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  mount(root, 
    subHeader({
      title: isNew ? "New bean" : "Edit bean",
      backLabel: "Cancel",
      onBack: () => goBack(detailRoute),
    }),
    h("form", { class: "form", novalidate: true, onsubmit: onSubmit },
      h("div", { class: "card form-card" }, name.el, origin.el, region.el, producer.el),
      h("h2", { class: "section-title" }, "Coffee"),
      h("div", { class: "card form-card" }, variety.el, process.el, altitude.el, cropYear.el, moisture.el),
      processList,
      firstPurchase
        ? [
            h("h2", { class: "section-title" }, "First purchase"),
            h("p", { class: "form-note" }, "Optional. Leave blank to add purchases later."),
            h("div", { class: "card form-card" }, firstPurchase.fields.map(f => f.el)),
            firstPurchase.datalist,
          ]
        : null,
      h("div", { class: "card form-card" }, notes.el),
      h("button", { type: "submit", class: "btn btn-accent btn-block" }, isNew ? "Add bean" : "Save changes")),
  );
}
