// Bean detail: stock, details, purchases, roasts (SPEC §5).
import { store } from "../store/index.js";
import { goBack } from "../router.js";
import { h, icon, subHeader, section, stockBadge, toast, mount } from "../ui.js";
import { formatWeight, formatMoney, formatDate, G_PER_LB } from "../units.js";
import { purchasedG, roastedG, remainingStockG, stockStatus, avgPricePerG, avgTastingScore } from "../derive.js";

export async function render(root, { beanId }) {
  const [bean, roasts, active, tastings, settings] = await Promise.all([
    store.beans.get(beanId),
    store.roasts.list(),
    store.active.get(),
    store.tastings.list(),
    store.settings.get(),
  ]);
  const unit = settings.weightUnit;
  const listRoute = bean?.archived ? "#/beans/archived" : "#/beans";

  if (!bean) {
    mount(root, 
      subHeader({ title: "Bean not found", backLabel: "Beans", onBack: () => goBack("#/beans") }),
      h("p", { class: "muted-block" }, "This bean may have been deleted."));
    return;
  }
  document.title = `${bean.name} · Roast Journal`;

  const beanRoasts = roasts.filter(r => r.beanId === bean.id)
    .sort((a, b) => (b.chargedAt ?? 0) - (a.chargedAt ?? 0));
  const remaining = remainingStockG(bean, roasts, active);
  const status = stockStatus(remaining, settings.defaultBatchG);
  const perG = avgPricePerG(bean);
  const score = avgTastingScore(bean.id, roasts, tastings);
  const base = `#/beans/${encodeURIComponent(bean.id)}`;

  const meta = [bean.origin, bean.region].filter(Boolean).join(", ");

  // ---- Stock card
  const stockCard = h("section", { class: `stock-card stock-card-${status}` },
    h("div", { class: "stock-card-top" },
      h("div", null,
        h("p", { class: "stock-card-label" }, "Remaining"),
        h("p", { class: "stock-card-value" }, formatWeight(remaining, unit))),
      stockBadge(status)),
    status !== "ok"
      ? h("p", { class: "stock-card-note" },
          status === "out"
            ? (remaining < 0 ? "More roasted than purchased. Is a purchase missing?" : "None left to roast.")
            : `Less than one ${formatWeight(settings.defaultBatchG, unit)} batch left.`)
      : null,
    h("dl", { class: "stock-card-facts" },
      fact("Purchased", formatWeight(purchasedG(bean), unit)),
      fact("Roasted", formatWeight(roastedG(bean.id, roasts, active), unit)),
      fact("Avg price", perG == null ? "—" : `${formatMoney(perG * G_PER_LB)}/lb`),
      fact("Avg score", score == null ? "—" : `${score.toFixed(1)} / 10`)));

  // ---- Details (only the filled-in fields)
  const detailRows = [
    ["Producer", bean.producer],
    ["Variety", bean.variety],
    ["Process", bean.process],
    ["Altitude", bean.altitudeM != null ? `${bean.altitudeM.toLocaleString("en-US")} m` : ""],
    ["Crop year", bean.cropYear != null ? String(bean.cropYear) : ""],
    ["Moisture", bean.moisturePct != null ? `${bean.moisturePct}%` : ""],
  ].filter(([, v]) => v);

  // ---- Purchases, newest first
  const purchases = [...(bean.purchases ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const purchaseList = purchases.length
    ? h("ul", { class: "list card" }, purchases.map(p =>
        h("li", null,
          h("a", { class: "list-row", href: `${base}/purchase/${encodeURIComponent(p.id)}`,
                   "aria-label": `Edit purchase from ${formatDate(p.date)}` },
            h("div", { class: "list-main" },
              h("span", { class: "list-title" }, formatDate(p.date)),
              h("span", { class: "list-meta" }, p.supplier || "No supplier")),
            h("div", { class: "list-side" },
              h("span", { class: "stock" }, formatWeight(p.grams, unit)),
              p.price != null
                ? h("span", { class: "list-meta" },
                    `${formatMoney(p.price)} · ${formatMoney(p.price / p.grams * G_PER_LB)}/lb`)
                : null),
            icon("chevron", "icon chevron")))))
    : h("p", { class: "card muted-block" }, "No purchases logged. Stock counts only what you log here.");

  // ---- Roasts of this bean
  const roastList = beanRoasts.length
    ? h("ul", { class: "list card" }, beanRoasts.map(r =>
        h("li", null,
          h("a", { class: "list-row", href: `#/roasts/${encodeURIComponent(r.id)}/finish` },
            h("div", { class: "list-main" },
              h("span", { class: "list-title" }, new Date(r.chargedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })),
              h("span", { class: "list-meta" }, r.roastLevel || "No level")),
            h("div", { class: "list-side" }, h("span", { class: "stock" }, formatWeight(r.greenG, unit))),
            icon("chevron", "icon chevron")))))
    : h("p", { class: "card muted-block" }, "No roasts of this bean yet.");
  const liveNote = active?.beanId === bean.id
    ? h("a", { class: "live-banner", href: "#/roast/live" },
        h("span", { class: "live-dot", "aria-hidden": "true" }),
        h("span", { class: "list-main" }, h("span", { class: "list-title" }, "Roasting now"),
          h("span", { class: "list-meta" }, `${formatWeight(active.greenG, unit)} counted as roasted`)),
        h("span", { class: "banner-return" }, "Return"))
    : null;

  // ---- Actions
  async function toggleArchive() {
    try {
      await store.beans.save({ ...bean, archived: !bean.archived });
      toast(bean.archived ? "Moved back to active" : "Archived");
      root.replaceChildren();
      await render(root, { beanId });
    } catch (err) {
      toast(err.message, { error: true });
    }
  }
  async function remove() {
    if (!confirm(`Delete "${bean.name}" and its ${purchases.length} purchase record(s)? This can't be undone.`)) return;
    try {
      await store.beans.remove(bean.id);
      toast("Bean deleted");
      goBack(listRoute);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  mount(root, 
    subHeader({
      title: bean.name,
      subtitle: meta || null,
      backLabel: "Beans",
      onBack: () => goBack(listRoute),
      action: h("a", { class: "head-action", href: `${base}/edit` }, "Edit"),
    }),
    bean.archived ? h("p", { class: "archived-note" }, "Archived. Hidden from the bean list and roast setup.") : null,
    stockCard,
    h("section", { class: "section" },
      h("div", { class: "section-head" },
        h("h2", { class: "section-title" }, "Purchases"),
        h("a", { class: "section-action", href: `${base}/purchase` }, icon("plus"), "Add purchase")),
      purchaseList),
    detailRows.length
      ? section("Details", detailRows.map(([k, v]) =>
          h("div", { class: "row" }, h("span", { class: "row-hint" }, k), h("span", { class: "row-value" }, v))))
      : null,
    bean.notes ? section("Notes", h("p", { class: "notes-block" }, bean.notes)) : null,
    h("section", { class: "section" }, h("h2", { class: "section-title" }, "Roasts"), liveNote, roastList),
    h("section", { class: "section actions" },
      h("button", { type: "button", class: "btn btn-block", onclick: toggleArchive },
        bean.archived ? "Unarchive" : "Archive"),
      beanRoasts.length
        ? h("p", { class: "field-hint" }, "Beans with roasts can be archived but not deleted.")
        : h("button", { type: "button", class: "btn btn-block btn-danger", onclick: remove }, "Delete bean")),
  );
}

function fact(label, value) {
  return h("div", null, h("dt", null, label), h("dd", null, value));
}
