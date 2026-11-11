// Entry module: build the tab bar, open the store, start the router.
import { store } from "./store/index.js";
import { startRouter } from "./router.js";
import { h, icon } from "./ui.js";
import * as roasts from "./screens/roasts.js";
import * as beans from "./screens/beans.js";
import * as tastings from "./screens/tastings.js";
import * as stats from "./screens/stats.js";
import * as settings from "./screens/settings.js";

const TABS = [
  ["roasts", roasts],
  ["beans", beans],
  ["tastings", tastings],
  ["stats", stats],
  ["settings", settings],
];

const view = document.getElementById("view");
const nav = document.getElementById("tabbar");

nav.append(...TABS.map(([name, screen]) =>
  h("a", { class: "tab", href: `#/${name}`, dataset: { tab: name } },
    icon(name), h("span", { class: "tab-label" }, screen.title))));

try {
  await store.init("local");
  startRouter({ view, nav, screens: Object.fromEntries(TABS), fallback: "roasts" });
} catch (err) {
  console.error(err);
  view.replaceChildren(h("div", { class: "fatal", role: "alert" },
    h("h1", null, "Couldn't open your data"),
    h("p", null, err?.message || String(err)),
    h("p", null, "Nothing has been changed or deleted.")));
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(err => console.warn("service worker:", err));
}
