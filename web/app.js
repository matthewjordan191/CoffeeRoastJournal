// Entry module: build the tab bar, open the store, start the router.
import { store } from "./store/index.js";
import { startRouter } from "./router.js";
import { h, icon } from "./ui.js";
import * as roasts from "./screens/roasts.js";
import * as beans from "./screens/beans.js";
import * as tastings from "./screens/tastings.js";
import * as stats from "./screens/stats.js";
import * as settings from "./screens/settings.js";
import * as roast from "./screens/roast.js";

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
  // Closed or reloaded mid-roast: open straight onto the timer. Swapping the
  // URL before the router starts adds no history entry.
  if ((await store.active.get()) && !location.hash.startsWith("#/roast/")) {
    history.replaceState(history.state, "", "#/roast/live");
  }
  // `roast` is a screen without a tab: #/roast/new (setup), #/roast/live.
  startRouter({ view, nav, screens: { ...Object.fromEntries(TABS), roast }, fallback: "roasts" });
} catch (err) {
  console.error(err);
  view.replaceChildren(h("div", { class: "fatal", role: "alert" },
    h("h1", null, "Couldn't open your data"),
    h("p", null, err?.message || String(err)),
    h("p", null, "Nothing has been changed or deleted.")));
}

let updateReady = false; // a new version has taken control of this page

if ("serviceWorker" in navigator) {
  // A new deploy's worker calls skipWaiting + clients.claim, so it takes over
  // this open page. The page is still running the old code, so offer a
  // reload; never reload by ourselves — that could cut into a live roast.
  // The very first install also fires controllerchange (claim), but there
  // was no old version then, so stay quiet.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) {
      updateReady = true;
      syncUpdateToast();
    }
    hadController = true;
  });
  // The live roast screen never shows it — it would cover Hold to Cool, and
  // a reload mid-roast is the last thing to invite. It appears as soon as
  // the roast is minimized, cooled or discarded (all of which leave the route).
  window.addEventListener("hashchange", syncUpdateToast);
  navigator.serviceWorker.register("./sw.js").catch(err => console.warn("service worker:", err));
}

function syncUpdateToast() {
  const existing = document.getElementById("update-toast");
  const onLiveRoast = location.hash.startsWith("#/roast/live");
  if (!updateReady || onLiveRoast) {
    existing?.remove();
    return;
  }
  if (existing) return;
  document.body.append(
    h("div", { id: "update-toast", class: "update-toast", role: "status" },
      h("button", { type: "button", onclick: () => location.reload() },
        "New version ready — tap to reload")));
}
