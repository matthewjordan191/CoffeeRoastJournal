// The one door to persisted data (SPEC §6.2). UI code imports `store` and
// never touches localStorage, IndexedDB or Firestore directly.
//
//   await store.init();                 // once, at boot
//   store.beans.list({ includeArchived }) / get(id) / save(bean) / remove(id)
//   store.roasts.list() / get(id) / save(r) / remove(id)      // finished roasts only
//   store.active.get() / save(a) / discard() / finish(roast)  // the roast in progress (roast-active)
//   store.tastings.list({ roastId }) / get(id) / save(t) / remove(id)
//   store.settings.get() / save(patch)
//   store.photos.put(blob) → id / get(id) → Blob|null / remove(id)
//   store.subscribe(fn) → unsubscribe   // fn({ collection, type, id? })
//
// Every method is async so a Firestore backend can slot in behind the same
// interface. list() returns records in insertion order; screens sort.
import { createLocalBackend } from "./local.js";
import { createActiveStore } from "./active.js";

export { StoreError } from "./local.js";
export { DEFAULT_SETTINGS, LIMITS } from "./settings.js";
export { newId } from "./ids.js"; // for ids of nested items and new roasts

const BACKENDS = {
  local: () => createLocalBackend(),
  // firestore: () => createFirestoreBackend(),   // later
};

let current = null;
let activeStore = null;
const listeners = new Set();

function emit(change) {
  for (const fn of listeners) {
    try { fn(change); } catch (err) { console.error("store listener failed", err); }
  }
}

function backend() {
  if (!current) throw new Error("store.init() must finish before the store is used");
  return current;
}

export const store = {
  async init(kind = "local") {
    if (current) return;
    const make = BACKENDS[kind];
    if (!make) throw new Error(`Unknown store backend "${kind}"`);
    const b = make();
    await b.init();
    b.subscribe(emit);
    // roast-active is always localStorage, whatever the backend (SPEC §3.2.1).
    activeStore = createActiveStore({ storage: window.localStorage, roasts: () => b.roasts, emit });
    current = b;
    await activeStore.cleanup();
  },
  get kind() { return backend().kind; },
  get beans() { return backend().beans; },
  get roasts() { return backend().roasts; },
  get active() { backend(); return activeStore; },
  get tastings() { return backend().tastings; },
  get settings() { return backend().settings; },
  get photos() { return backend().photos; },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
