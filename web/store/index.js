// The one door to persisted data (SPEC §6.2). UI code imports `store` and
// never touches localStorage, IndexedDB or Firestore directly.
//
//   await store.init();                 // once, at boot
//   store.beans.list({ includeArchived }) / get(id) / save(bean) / remove(id)
//   store.roasts.list() / get(id) / save(r) / remove(id) / getActive()
//   store.tastings.list({ roastId }) / get(id) / save(t) / remove(id)
//   store.settings.get() / save(patch)
//   store.photos.put(blob) → id / get(id) → Blob|null / remove(id)
//   store.subscribe(fn) → unsubscribe   // fn({ collection, type, id? })
//
// Every method is async so a Firestore backend can slot in behind the same
// interface. list() returns records in insertion order; screens sort.
import { createLocalBackend } from "./local.js";

export { StoreError } from "./local.js";
export { DEFAULT_SETTINGS, LIMITS } from "./settings.js";
export { newId } from "./ids.js"; // for ids of nested items, e.g. a bean's purchases

const BACKENDS = {
  local: () => createLocalBackend(),
  // firestore: () => createFirestoreBackend(),   // later
};

let active = null;

function backend() {
  if (!active) throw new Error("store.init() must finish before the store is used");
  return active;
}

export const store = {
  async init(kind = "local") {
    if (active) return;
    const make = BACKENDS[kind];
    if (!make) throw new Error(`Unknown store backend "${kind}"`);
    const b = make();
    await b.init();
    active = b;
  },
  get kind() { return backend().kind; },
  get beans() { return backend().beans; },
  get roasts() { return backend().roasts; },
  get tastings() { return backend().tastings; },
  get settings() { return backend().settings; },
  get photos() { return backend().photos; },
  subscribe(fn) { return backend().subscribe(fn); },
};
