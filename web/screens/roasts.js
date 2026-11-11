// Roasts (SPEC §5): Start Roast, the in-progress banner, and history.
// Routes:
//   #/roasts                list
//   #/roasts/log            backfill a past roast by hand
//   #/roasts/<id>           detail
//   #/roasts/<id>/edit      edit times, values, events
//   #/roasts/<id>/finish    roasted weight, level, rating, notes, photo
import { store } from "../store/index.js";
import { h, icon, mount, screenHeader } from "../ui.js";
import { formatClock, formatWeight } from "../units.js";
import { elapsedS, totalTimeS, developmentRatio, weightLossPct, daysSinceRoast, isRested } from "../derive.js";
import * as finish from "./roast-finish.js";
import * as detail from "./roast-detail.js";
import * as editor from "./roast-editor.js";

export const title = "Roasts";

export function render(root, { params }) {
  const [id, sub] = params;
  if (!id) return renderList(root);
  if (id === "log" && !sub) return editor.render(root, { roastId: null });
  if (!sub) return detail.render(root, { roastId: id });
  if (sub === "finish") return finish.render(root, { roastId: id });
  if (sub === "edit") return editor.render(root, { roastId: id });
  throw new Error("That page doesn't exist.");
}

async function renderList(root) {
  const [active, roasts, settings] = await Promise.all([
    store.active.get(), store.roasts.list(), store.settings.get(),
  ]);
  roasts.sort((a, b) => b.chargedAt - a.chargedAt);
  const cleanups = [];

  let top;
  if (active) {
    const clock = h("span", { class: "banner-clock" });
    const paint = () => { clock.textContent = formatClock(elapsedS(active.chargedAt, Date.now())); };
    paint();
    const timer = setInterval(paint, 1000);
    cleanups.push(() => clearInterval(timer));
    top = h("a", { class: "live-banner", href: "#/roast/live" },
      h("span", { class: "live-dot", "aria-hidden": "true" }),
      h("span", { class: "list-main" },
        h("span", { class: "list-title" }, "Roast in progress"),
        h("span", { class: "list-meta" }, active.beanName)),
      clock,
      h("span", { class: "banner-return" }, "Return"));
  } else {
    top = h("a", { class: "btn btn-accent btn-block btn-start", href: "#/roast/new" }, icon("roasts"), "Start roast");
  }
  const logLink = h("a", { class: "log-link", href: "#/roasts/log" }, "Log a past roast by hand");

  const list = roasts.length
    ? h("ul", { class: "list card" }, roasts.map(r => {
        const total = totalTimeS(r);
        const dtr = developmentRatio(r.milestones, total);
        const loss = weightLossPct(r);
        const date = new Date(r.chargedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const meta = [date, formatClock(total), dtr == null ? null : `DTR ${dtr.toFixed(1)}%`, r.roastLevel].filter(Boolean).join(" · ");
        const days = daysSinceRoast(r);
        const rested = isRested(r);
        return h("li", null,
          h("a", { class: "list-row", href: `#/roasts/${encodeURIComponent(r.id)}` },
            h("div", { class: "list-main" },
              h("span", { class: "list-title" }, r.beanName),
              h("span", { class: "list-meta" }, meta),
              h("span", { class: "list-meta row-extras" },
                r.rating ? h("span", { class: "stars-inline", "aria-label": `${r.rating} of 5 stars` }, "★".repeat(r.rating)) : null,
                days == null ? null : h("span", { class: `day-chip${rested === false ? " resting" : ""}` },
                  rested === false ? `Day ${days} of ${r.restDaysPlanned}` : `Day ${days}`))),
            h("div", { class: "list-side" },
              loss == null
                ? h("span", { class: "pill pill-warn" }, "Unfinished")
                : h("span", { class: "stock" }, `−${loss.toFixed(1)}%`),
              h("span", { class: "list-meta" }, formatWeight(r.greenG, settings.weightUnit))),
            icon("chevron", "icon chevron")));
      }))
    : h("section", { class: "empty" },
        h("div", { class: "empty-icon" }, icon("roasts")),
        h("h2", null, "No roasts yet"),
        h("p", null, "Tap Start roast when the beans are weighed and the roaster is ready."));

  mount(root,
    screenHeader(title),
    h("div", { class: "roasts-top" }, top, logLink),
    roasts.length ? h("h2", { class: "section-title history-title" }, "History") : null,
    list);

  return () => cleanups.forEach(fn => fn());
}
