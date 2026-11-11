// After Cool (SPEC §2.1 steps 5–6): 3:00 cooling countdown, then the finish form —
// roasted weight, level, rating, notes, photo. Everything is optional and
// can be completed later from the Roasts tab.  Route: #/roasts/<id>/finish
import { store } from "../store/index.js";
import { goBack } from "../router.js";
import { h, mount, subHeader, field, textInput, toast } from "../ui.js";
import { formatClock, weightValue, toGrams, parseDecimal } from "../units.js";
import { elapsedS, milestoneT, totalTimeS, developmentS, developmentRatio, phaseTimes, weightLossPct } from "../derive.js";
import { ROAST_LEVELS, COOLING_S } from "../roast-session.js";
import { downscaleImage } from "../image.js";

export async function render(root, { roastId }) {
  const [roast, settings] = await Promise.all([store.roasts.get(roastId), store.settings.get()]);
  if (!roast) {
    mount(root,
      subHeader({ title: "Roast not found", backLabel: "Roasts", onBack: () => goBack("#/roasts") }),
      h("p", { class: "muted-block" }, "This roast may have been deleted."));
    return;
  }
  const unit = settings.weightUnit;
  const when = new Date(roast.chargedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  document.title = `${roast.beanName} · Roast Journal`;
  const cleanups = [];

  // ---- cooling: the SR800 always cools for 3:00, so this is a countdown
  // that stops by itself. coolingDone was recorded at Cool (cool + 3:00);
  // roasts saved before that change fall back to the same rule.
  const coolT = milestoneT(roast, "cool");
  const coolEndT = milestoneT(roast, "coolingDone") ?? coolT + COOLING_S;
  const coolClock = h("p", { class: "cool-clock", role: "timer" });
  const coolLabel = h("p", { class: "stock-card-label" });
  const coolCard = h("section", { class: "stock-card cooling-card" }, coolLabel, coolClock);

  let coolTimer = 0;
  function paintCooling() {
    const left = coolEndT - elapsedS(roast.chargedAt, Date.now());
    if (left > 0) {
      coolLabel.textContent = "Cooling — time left";
      coolClock.textContent = formatClock(Math.ceil(left));
    } else {
      coolLabel.textContent = "Cooled in";
      coolClock.textContent = formatClock(coolEndT - coolT);
      coolCard.classList.add("done");
      clearInterval(coolTimer);
    }
  }
  paintCooling();
  if (!coolCard.classList.contains("done")) {
    coolTimer = setInterval(paintCooling, 500);
    cleanups.push(() => clearInterval(coolTimer));
  }

  // ---- summary
  const total = totalTimeS(roast);
  const phases = phaseTimes(roast);
  const dtr = developmentRatio(roast.milestones, total);
  const summary = h("dl", { class: "stock-card-facts summary-facts" },
    fact("Total", formatClock(total)),
    fact("Development", formatClock(developmentS(roast.milestones, total))),
    fact("DTR", dtr == null ? "—" : `${dtr.toFixed(1)}%`),
    fact("Drying", formatClock(phases.dryingS)),
    fact("Maillard", formatClock(phases.maillardS)),
    fact("Green", `${weightValue(roast.greenG, unit)} ${unit}`));

  // ---- form
  const roasted = field({
    id: "finish-roasted", label: "Roasted weight", optional: true, suffix: unit,
    input: textInput({ inputmode: "decimal", value: roast.roastedG == null ? "" : weightValue(roast.roastedG, unit) }),
  });
  const lossText = h("p", { class: "field-hint", "aria-live": "polite" });
  roasted.el.append(lossText);
  const showLoss = () => {
    const g = toGrams(parseDecimal(roasted.input.value) ?? NaN, unit);
    const pct = weightLossPct({ greenG: roast.greenG, roastedG: Number.isFinite(g) ? g : null });
    lossText.textContent = pct == null ? "Weight loss shows here." : `Weight loss ${pct.toFixed(1)}%`;
  };
  roasted.input.addEventListener("input", showLoss);
  showLoss();

  const levelGroup = h("div", { class: "chips", role: "radiogroup", "aria-labelledby": "level-label" },
    ROAST_LEVELS.map(level => h("label", { class: "chip" },
      h("input", { type: "radio", name: "roast-level", value: level, checked: roast.roastLevel === level }),
      h("span", null, level))));
  const ratingGroup = h("div", { class: "stars", role: "radiogroup", "aria-labelledby": "rating-label" },
    [1, 2, 3, 4, 5].map(n => h("label", { class: "star", title: `${n} of 5` },
      h("input", { type: "radio", name: "roast-rating", value: String(n), checked: roast.rating === n, "aria-label": `${n} of 5` }),
      h("span", { "aria-hidden": "true" }, "★"))));
  const paintStars = () => {
    const r = Number(root.querySelector("input[name=roast-rating]:checked")?.value ?? 0);
    ratingGroup.querySelectorAll(".star").forEach((s, i) => s.classList.toggle("lit", i < r));
  };
  ratingGroup.addEventListener("change", paintStars);

  const notes = field({
    id: "finish-notes", label: "Notes", optional: true,
    input: h("textarea", { class: "text-input", rows: "4", value: roast.notes ?? "", placeholder: "How did it go? What would you change?" }),
  });

  // ---- photo: held in memory until Save, then downscaled blob → IndexedDB
  let pendingBlob = null;
  let removePhoto = false;
  let previewUrl = null;
  const img = h("img", { class: "photo-preview", alt: "Roast photo", hidden: true });
  const fileInput = h("input", { type: "file", accept: "image/*", class: "visually-hidden", id: "finish-photo" });
  const pickLabel = h("label", { class: "btn btn-block photo-pick", for: "finish-photo" }, "Add photo");
  const removeBtn = h("button", { type: "button", class: "btn btn-block btn-danger", hidden: true }, "Remove photo");
  const photoStatus = h("p", { class: "field-hint", "aria-live": "polite" });
  const showPreview = blob => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = blob ? URL.createObjectURL(blob) : null;
    img.hidden = !blob;
    if (blob) img.src = previewUrl; else img.removeAttribute("src");
    pickLabel.textContent = blob ? "Replace photo" : "Add photo";
    removeBtn.hidden = !blob;
  };
  cleanups.push(() => previewUrl && URL.revokeObjectURL(previewUrl));
  if (roast.photoId) {
    store.photos.get(roast.photoId).then(b => { if (b && !pendingBlob && !removePhoto) showPreview(b); }).catch(() => {});
  }
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    photoStatus.textContent = "Preparing photo…";
    try {
      const { blob, width, height } = await downscaleImage(file);
      pendingBlob = blob;
      removePhoto = false;
      showPreview(blob);
      photoStatus.textContent = `${width}×${height}, ${Math.round(blob.size / 1024)} KB — saved with the roast.`;
    } catch (err) {
      photoStatus.textContent = err.message;
    }
  });
  removeBtn.addEventListener("click", () => {
    pendingBlob = null;
    removePhoto = true;
    showPreview(null);
    photoStatus.textContent = "";
  });

  async function save(e) {
    e.preventDefault();
    roasted.setError("");
    const text = roasted.input.value.trim();
    const g = text ? toGrams(parseDecimal(text) ?? NaN, unit) : null;
    if (g != null && !(g > 0 && g <= roast.greenG)) {
      roasted.setError(`Enter more than 0 and at most the green weight (${weightValue(roast.greenG, unit)} ${unit}).`);
      roasted.input.focus();
      return;
    }
    const fresh = await store.roasts.get(roastId);
    if (!fresh) { toast("This roast was deleted.", { error: true }); return; }
    try {
      let photoId = fresh.photoId ?? null;
      if (pendingBlob) {
        const newId = await store.photos.put(pendingBlob);
        if (photoId) await store.photos.remove(photoId).catch(() => {});
        photoId = newId;
      } else if (removePhoto && photoId) {
        await store.photos.remove(photoId).catch(() => {});
        photoId = null;
      }
      const levelValue = root.querySelector("input[name=roast-level]:checked")?.value ?? null;
      const ratingValue = root.querySelector("input[name=roast-rating]:checked")?.value;
      await store.roasts.save({
        ...fresh,
        roastedG: g,
        roastLevel: levelValue,
        rating: ratingValue ? Number(ratingValue) : null,
        notes: notes.input.value.trim(),
        photoId,
      });
      pendingBlob = null;
      toast("Roast saved");
      goBack("#/roasts");
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  mount(root,
    subHeader({ title: roast.beanName, subtitle: `Roasted ${when}`, backLabel: "Roasts", onBack: () => goBack("#/roasts") }),
    coolCard,
    h("section", { class: "section" }, h("h2", { class: "section-title" }, "Roast"), h("div", { class: "card summary-card" }, summary)),
    h("form", { class: "form", novalidate: true, onsubmit: save },
      h("h2", { class: "section-title" }, "Finish"),
      h("p", { class: "form-note" }, "All optional — you can finish this later from Roasts."),
      h("div", { class: "card form-card" },
        roasted.el,
        h("div", { class: "field" }, h("span", { class: "field-label", id: "level-label" }, "Roast level"), levelGroup),
        h("div", { class: "field" }, h("span", { class: "field-label", id: "rating-label" }, "Rating"), ratingGroup),
        notes.el),
      h("div", { class: "card form-card" },
        h("div", { class: "field" },
          h("span", { class: "field-label" }, "Photo"),
          img, fileInput, pickLabel, removeBtn, photoStatus)),
      h("button", { type: "submit", class: "btn btn-accent btn-block" }, "Save roast")),
  );
  paintStars();

  return () => cleanups.forEach(fn => fn());
}

function fact(label, value) {
  return h("div", null, h("dt", null, label), h("dd", null, value));
}
