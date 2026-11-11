// Beans (SPEC §5). Routes:
//   #/beans                      active beans
//   #/beans/archived             archived beans
//   #/beans/new                  add form
//   #/beans/<id>                 detail
//   #/beans/<id>/edit            edit form
//   #/beans/<id>/purchase[/<pid>]  add / edit a purchase
import { store } from "../store/index.js";
import { navigate } from "../router.js";
import { h, icon, screenHeader, segmented, stockBadge, mount } from "../ui.js";
import { formatWeight } from "../units.js";
import { remainingStockG, stockStatus } from "../derive.js";
import * as beanDetail from "./bean-detail.js";
import * as beanForm from "./bean-form.js";
import * as purchaseForm from "./purchase-form.js";

export const title = "Beans";

export function render(root, { params }) {
  const [a, b, c] = params;
  if (!a || a === "archived") return renderList(root, a === "archived");
  if (a === "new") return beanForm.render(root, { beanId: null });
  if (!b) return beanDetail.render(root, { beanId: a });
  if (b === "edit") return beanForm.render(root, { beanId: a });
  if (b === "purchase") return purchaseForm.render(root, { beanId: a, purchaseId: c ?? null });
  throw new Error("That page doesn't exist.");
}

const byName = (x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" });

async function renderList(root, showArchived) {
  const [beans, roasts, settings] = await Promise.all([
    store.beans.list({ includeArchived: true }),
    store.roasts.list(),
    store.settings.get(),
  ]);
  // TODO(live roast): pass store.active.get() so the in-progress roast counts (SPEC §4).
  const stock = new Map(beans.map(b => [b.id, remainingStockG(b, roasts)]));
  const active = beans.filter(b => !b.archived).sort(byName);
  const archived = beans.filter(b => b.archived).sort(byName);
  const shown = showArchived ? archived : active;

  const onHand = active.reduce((total, b) => total + Math.max(0, stock.get(b.id)), 0);
  const subtitle = active.length
    ? `${active.length} ${active.length === 1 ? "bean" : "beans"} · ${formatWeight(onHand, settings.weightUnit)} on hand`
    : null;

  const toggle = segmented({
    name: "bean-filter", ariaLabel: "Which beans to show",
    value: showArchived ? "archived" : "active",
    options: [
      { value: "active", label: `Active (${active.length})` },
      { value: "archived", label: `Archived (${archived.length})` },
    ],
    onChange: v => navigate(v === "archived" ? "#/beans/archived" : "#/beans", { replace: true }),
  });

  mount(root, 
    screenHeader(title,
      h("a", { class: "btn btn-accent btn-small", href: "#/beans/new" }, icon("plus"), "Add")),
    subtitle ? h("p", { class: "screen-subtitle" }, subtitle) : null,
    archived.length || showArchived ? h("div", { class: "filter-bar" }, toggle.el) : null,
    shown.length
      ? h("ul", { class: "list card" }, shown.map(b => beanRow(b, stock.get(b.id), settings)))
      : emptyState(showArchived),
  );
}

function beanRow(bean, remainingG, settings) {
  const status = stockStatus(remainingG, settings.defaultBatchG);
  const meta = [bean.origin, bean.process].filter(Boolean).join(" · ");
  return h("li", null,
    h("a", { class: "list-row", href: `#/beans/${encodeURIComponent(bean.id)}` },
      h("div", { class: "list-main" },
        h("span", { class: "list-title" }, bean.name),
        meta ? h("span", { class: "list-meta" }, meta) : null),
      h("div", { class: "list-side" },
        h("span", { class: `stock stock-${status}` }, formatWeight(Math.max(0, remainingG), settings.weightUnit)),
        stockBadge(status)),
      icon("chevron", "icon chevron")));
}

function emptyState(showArchived) {
  if (showArchived) {
    return h("section", { class: "empty" }, h("p", null, "No archived beans."));
  }
  return h("section", { class: "empty" },
    h("div", { class: "empty-icon" }, icon("beans")),
    h("h2", null, "No beans yet"),
    h("p", null, "Add the green coffees you buy. Log each purchase, and see how much is left to roast."),
    h("a", { class: "btn btn-accent empty-cta", href: "#/beans/new" }, icon("plus"), "Add a bean"));
}
