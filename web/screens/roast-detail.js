// Roast detail (SPEC §5): photo, derived values, one merged timeline of
// milestones, fan/heat changes, display temps and notes, and actions:
// Finish details, Edit, Roast this again, Delete.   Route: #/roasts/<id>
import { store } from "../store/index.js";
import { goBack, navigate } from "../router.js";
import { h, mount, subHeader, section, toast, confirmSheet, icon } from "../ui.js";
import { formatClock, formatWeight, formatTemp, formatMoney } from "../units.js";
import {
  totalTimeS, developmentS, developmentRatio, phaseTimes, coolingS, weightLossPct,
  timeAtSettings, daysSinceRoast, isRested, costPerRoast,
} from "../derive.js";
import { LIVE_MILESTONES } from "../roast-session.js";

const MILESTONE_LABEL = Object.fromEntries([
  ["charge", "Charge"], ...LIVE_MILESTONES.map(m => [m.type, m.label]), ["cool", "Cool"], ["coolingDone", "Cooling done"],
]);

export async function render(root, { roastId }) {
  const [roast, settings] = await Promise.all([store.roasts.get(roastId), store.settings.get()]);
  if (!roast) {
    mount(root,
      subHeader({ title: "Roast not found", backLabel: "Roasts", onBack: () => goBack("#/roasts") }),
      h("p", { class: "muted-block" }, "This roast may have been deleted."));
    return;
  }
  const bean = await store.beans.get(roast.beanId);
  const unit = settings.weightUnit;
  const base = `#/roasts/${encodeURIComponent(roast.id)}`;
  document.title = `${roast.beanName} · Roast Journal`;
  const cleanups = [];

  const when = new Date(roast.chargedAt).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const days = daysSinceRoast(roast);
  const rested = isRested(roast);

  // ---- photo
  let photoEl = null;
  if (roast.photoId) {
    photoEl = h("img", { class: "photo-preview detail-photo", alt: `Photo of the ${roast.beanName} roast`, hidden: true });
    store.photos.get(roast.photoId).then(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      cleanups.push(() => URL.revokeObjectURL(url));
      photoEl.src = url;
      photoEl.hidden = false;
    }).catch(() => {});
  }

  // ---- derived values
  const total = totalTimeS(roast);
  const phases = phaseTimes(roast);
  const dtr = developmentRatio(roast.milestones, total);
  const loss = weightLossPct(roast);
  const cost = costPerRoast(roast, bean);
  const fact = (label, value) => h("div", null, h("dt", null, label), h("dd", null, value));
  const facts = h("dl", { class: "stock-card-facts summary-facts" },
    fact("Total", formatClock(total)),
    fact("Development", formatClock(developmentS(roast.milestones, total))),
    fact("DTR", dtr == null ? "—" : `${dtr.toFixed(1)}%`),
    fact("Drying", formatClock(phases.dryingS)),
    fact("Maillard", formatClock(phases.maillardS)),
    fact("Cooling", formatClock(coolingS(roast))),
    fact("Green", formatWeight(roast.greenG, unit)),
    fact("Roasted", formatWeight(roast.roastedG, unit)),
    fact("Weight loss", loss == null ? "—" : `${loss.toFixed(1)}%`),
    fact("Level", roast.roastLevel ?? "—"),
    fact("Rating", roast.rating
      ? h("span", { class: "stars-fact", "aria-label": `${roast.rating} of 5 stars` },
          h("span", { class: "lit" }, "★".repeat(roast.rating)), "★".repeat(5 - roast.rating))
      : "—"),
    fact("Rest", days == null ? "—" : `Day ${days}${roast.restDaysPlanned != null ? ` of ${roast.restDaysPlanned}` : ""}`),
    fact("Ambient", formatTemp(roast.ambientC, settings.tempUnit)),
    fact("Ext. tube", roast.extensionTube === false ? "No" : "Yes"),
    fact("Cost", cost == null ? "—" : formatMoney(cost)));

  // ---- time at each setting
  const tas = timeAtSettings(roast);
  const settingRows = tas
    ? ["fan", "heat"].map(control => {
        const entries = Object.entries(tas[control]).sort((x, y) => y[1] - x[1]);
        return h("div", { class: "row" },
          h("span", { class: "row-hint" }, control === "fan" ? "Fan" : "Heat"),
          h("span", { class: "row-value setting-spans" },
            entries.map(([v, s]) => h("span", { class: "setting-span" }, h("b", null, v), ` ${formatClock(s)}`))));
      })
    : [];

  // ---- one merged timeline
  const items = [
    ...roast.milestones.map(m => ({ t: m.t, kind: "ms", order: 0, label: MILESTONE_LABEL[m.type] ?? m.type, type: m.type })),
    ...roast.controlEvents.map(e => ({
      t: e.t, kind: "ctl", order: 1,
      label: e.t === 0 ? `Start ${e.control} ${e.value}` : `${e.control === "fan" ? "Fan" : "Heat"} → ${e.value}`,
    })),
    ...(roast.displayTemps ?? []).map(r => ({ t: r.t, kind: "temp", order: 2, label: `Display ${formatTemp(r.displayC, settings.tempUnit)}` })),
    ...(roast.notesLog ?? []).map(n => ({ t: n.t, kind: "note", order: 3, label: n.text })),
  ].sort((a, b) => a.t - b.t || a.order - b.order);
  const timeline = h("ol", { class: "timeline card" },
    items.map(it => h("li", { class: `tl-item tl-${it.kind}${it.type ? ` tl-${it.type}` : ""}` },
      h("span", { class: "tl-time" }, formatClock(it.t)),
      h("span", { class: "tl-dot", "aria-hidden": "true" }),
      h("span", { class: "tl-label" }, it.label))));

  // ---- actions
  async function remove() {
    const ok = await confirmSheet({
      title: "Delete this roast?",
      body: `${roast.beanName}, ${new Date(roast.chargedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Its tastings and photo are deleted too, and its green weight goes back into the bean's stock. This can't be undone.`,
      confirmLabel: "Delete roast", cancelLabel: "Keep", danger: true,
    });
    if (!ok) return;
    try {
      await store.roasts.remove(roast.id);
      toast("Roast deleted");
      goBack("#/roasts");
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  const unfinished = roast.roastedG == null || !roast.roastLevel || !roast.rating;

  mount(root,
    subHeader({
      title: roast.beanName,
      subtitle: `${when}${days != null ? ` · Day ${days}` : ""}${rested === false ? " · resting" : rested ? " · rested" : ""}`,
      backLabel: "Roasts",
      onBack: () => goBack("#/roasts"),
      action: h("a", { class: "head-action", href: `${base}/edit` }, "Edit"),
    }),
    unfinished
      ? h("a", { class: "finish-nudge", href: `${base}/finish` },
          h("span", { class: "list-main" },
            h("span", { class: "list-title" }, "Finish this roast"),
            h("span", { class: "list-meta" }, "Add roasted weight, level, rating or a photo")),
          icon("chevron", "icon chevron"))
      : null,
    photoEl,
    h("section", { class: "section" }, h("h2", { class: "section-title" }, "Roast"), h("div", { class: "card summary-card" }, facts)),
    bean
      ? h("a", { class: "bean-link card", href: `#/beans/${encodeURIComponent(bean.id)}` },
          h("span", { class: "row-hint" }, "Bean"), h("span", { class: "list-title" }, bean.name), icon("chevron", "icon chevron"))
      : null,
    settingRows.length ? section("Time at each setting", settingRows) : null,
    h("section", { class: "section" }, h("h2", { class: "section-title" }, "Timeline"), timeline),
    roast.notes ? section("Notes", h("p", { class: "notes-block" }, roast.notes)) : null,
    h("section", { class: "section actions" },
      h("button", { type: "button", class: "btn btn-accent btn-block", onclick: () => navigate(`#/roast/new/${encodeURIComponent(roast.id)}`) },
        "Roast this again"),
      h("a", { class: "btn btn-block link-btn", href: `${base}/finish` }, unfinished ? "Finish details" : "Edit finish details"),
      h("button", { type: "button", class: "btn btn-block btn-danger", onclick: remove }, "Delete roast")),
  );

  return () => cleanups.forEach(fn => fn());
}
