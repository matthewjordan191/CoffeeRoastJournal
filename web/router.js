// Hash router: "#/<screen>/<param>/<param>…". Every navigation is a normal
// hash change, so the browser history (and iOS swipe-back / Back) walks one
// screen at a time with no extra bookkeeping.
//
// A screen module exports `title` and `render(root, { params })`. render may
// be async and may return a cleanup function, called when the screen is left.
// Optional `fullscreen` (boolean or (params) => boolean) hides the tab bar.

// Each history entry this app creates is stamped with its position
// (history.state.roastIdx), so an on-screen Back button knows whether
// stepping back stays inside the app. Position 0 is wherever the app was
// opened — e.g. straight on a deep link like #/beans/<id> — and Back from
// there goes to the parent screen instead of leaving the app. The stamp
// lives in history.state, so it survives reloads, and revisiting a route
// can't be mistaken for going back.
let position = 0;
let stamped = false;   // has any entry been stamped yet in this page load?
let replacing = false;

function track() {
  const idx = history.state?.roastIdx;
  if (Number.isInteger(idx)) {
    position = idx;                       // Back/Forward/reload onto a known entry
  } else {
    if (stamped && !replacing) position += 1; // a new entry pushed on top
    history.replaceState({ ...(history.state ?? {}), roastIdx: position }, "");
  }
  stamped = true;
  replacing = false;
}

/** Go to a route. `replace` swaps the current history entry (e.g. after saving a form). */
export function navigate(hash, { replace = false } = {}) {
  if (hash === location.hash) return;
  if (replace) {
    replacing = true;
    location.replace(hash);
  } else {
    location.hash = hash;
  }
}

/** Step back within the app; if there's no in-app history, replace with `fallback`. */
export function goBack(fallback) {
  if (position > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function startRouter({ view, nav, screens, fallback }) {
  let cleanup = null;
  let currentKey = null;
  let seq = 0;
  let first = true;
  const scrollByRoute = new Map(); // remembered per hash, so Back/tab returns where you were

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  function parse() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [name = "", ...params] = raw.split("/").filter(Boolean).map(decodeURIComponent);
    return { name, params };
  }

  async function render() {
    const { name, params } = parse();
    const screen = screens[name];
    if (!screen) {
      navigate(`#/${fallback}`, { replace: true }); // a bad/empty hash leaves no history entry
      return;
    }
    track();

    if (currentKey) scrollByRoute.set(currentKey, window.scrollY);
    if (typeof cleanup === "function") cleanup();
    cleanup = null;
    currentKey = location.hash;

    // Fresh container per render: if a slow async render is overtaken by a
    // newer one, the stale render writes into a detached node, not the page.
    const token = ++seq;
    const root = document.createElement("div");
    root.className = "screen";
    root.dataset.screen = name;
    view.replaceChildren(root);

    // Full-screen screens (the live roast) hide the tab bar. `fullscreen` may
    // be a boolean or a function of the route params.
    const full = typeof screen.fullscreen === "function" ? screen.fullscreen(params) : !!screen.fullscreen;
    document.body.classList.toggle("no-tabbar", full);

    for (const a of nav.querySelectorAll("a[data-tab]")) {
      if (a.dataset.tab === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = `${screen.title} · Roast Journal`;

    let result;
    try {
      result = await screen.render(root, { params });
    } catch (err) {
      console.error(err);
      root.replaceChildren(errorBox(err));
    }
    if (token !== seq) {
      if (typeof result === "function") result();
      return;
    }
    cleanup = result;

    window.scrollTo(0, scrollByRoute.get(currentKey) ?? 0);
    if (!first) root.querySelector("h1")?.focus({ preventScroll: true }); // announce the new screen
    first = false;
  }

  // Tapping the tab you're already on scrolls back to the top (iOS convention).
  nav.addEventListener("click", e => {
    const a = e.target.closest("a[data-tab]");
    if (a && a.getAttribute("href") === location.hash) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  window.addEventListener("hashchange", render);
  render();
}

function errorBox(err) {
  const box = document.createElement("div");
  box.className = "fatal";
  box.setAttribute("role", "alert");
  box.textContent = `Something went wrong: ${err?.message || err}`;
  return box;
}
