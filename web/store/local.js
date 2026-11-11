// localStorage backend for the store (SPEC §6.2).
//
// Each collection is one JSON array under a "roast-" key; the whole array is
// kept in memory and written back on every change. Writes go to storage
// *before* memory, so a failed write (quota, private mode) leaves both
// unchanged and the caller gets the error.
import { DEFAULT_SETTINGS, invalidSettingsFields, normalizeSettings } from "./settings.js";
import { photos } from "./photos.js";
import { newId } from "./ids.js";

export const SCHEMA_VERSION = 1;

export const KEYS = Object.freeze({
  beans: "roast-beans",
  roasts: "roast-roasts",
  tastings: "roast-tastings",
  settings: "roast-settings",
  schema: "roast-schema",
});

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoreError";
    this.code = code; // "IN_USE" | "ACTIVE_EXISTS" | "INVALID" | "WRITE_FAILED" | "CORRUPT" | "NEWER_SCHEMA"
  }
}

const clone = v => structuredClone(v);

export function createLocalBackend(storage = window.localStorage) {
  const state = { beans: [], roasts: [], tastings: [], settings: { ...DEFAULT_SETTINGS } };
  const listeners = new Set();

  function emit(change) {
    for (const fn of listeners) {
      try { fn(change); } catch (err) { console.error("store listener failed", err); }
    }
  }

  // A corrupt value is reported, never silently replaced: overwriting it on
  // the next save would destroy whatever is left of the user's data.
  function read(key, fallback, isValid) {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    let value;
    try { value = JSON.parse(raw); } catch { value = undefined; }
    if (!isValid(value)) throw new StoreError("CORRUPT", `Saved data under "${key}" is unreadable.`);
    return value;
  }

  function load() {
    const schema = storage.getItem(KEYS.schema);
    if (schema != null && Number(schema) > SCHEMA_VERSION) {
      throw new StoreError("NEWER_SCHEMA", "This data was saved by a newer version of the app. Reload to update.");
    }
    state.beans = read(KEYS.beans, [], Array.isArray);
    state.roasts = read(KEYS.roasts, [], Array.isArray);
    state.tastings = read(KEYS.tastings, [], Array.isArray);
    state.settings = normalizeSettings(read(KEYS.settings, null, v => v && typeof v === "object"));
    if (schema == null) write(KEYS.schema, SCHEMA_VERSION);
  }

  function write(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      throw new StoreError("WRITE_FAILED", `Couldn't save (${err?.name || "storage error"}). Storage may be full.`);
    }
  }

  function commit(name, next) {
    write(KEYS[name], next);
    state[name] = next;
  }

  function collection(name, { filter, guardSave, beforeRemove } = {}) {
    return {
      async list(opts = {}) {
        const items = filter ? state[name].filter(r => filter(r, opts)) : state[name];
        return clone(items);
      },
      async get(id) {
        const found = state[name].find(r => r.id === id);
        return found ? clone(found) : null;
      },
      /** Upsert. Assigns id/createdAt on insert and updatedAt always; returns the saved record. */
      async save(record) {
        if (!record || typeof record !== "object") throw new TypeError(`${name}.save expects an object`);
        const existing = record.id ? state[name].find(r => r.id === record.id) : null;
        const now = Date.now();
        const saved = {
          ...clone(record),
          id: record.id || newId(),
          createdAt: existing?.createdAt ?? record.createdAt ?? now,
          updatedAt: now,
        };
        guardSave?.(saved);
        const next = existing
          ? state[name].map(r => (r.id === saved.id ? saved : r))
          : [...state[name], saved];
        commit(name, next);
        emit({ collection: name, type: "save", id: saved.id });
        return clone(saved);
      },
      async remove(id) {
        const found = state[name].find(r => r.id === id);
        if (!found) return;
        await beforeRemove?.(found);
        commit(name, state[name].filter(r => r.id !== id));
        emit({ collection: name, type: "remove", id });
      },
    };
  }

  const beans = collection("beans", {
    filter: (b, { includeArchived = false }) => includeArchived || !b.archived,
    beforeRemove(bean) {
      if (state.roasts.some(r => r.beanId === bean.id)) {
        throw new StoreError("IN_USE", "This bean has roasts. Archive it instead of deleting.");
      }
    },
  });

  const roasts = collection("roasts", {
    guardSave(roast) {
      if (roast.status !== "active") return;
      const other = state.roasts.find(r => r.status === "active" && r.id !== roast.id);
      if (other) throw new StoreError("ACTIVE_EXISTS", "Another roast is already in progress.");
    },
    // Cascade: a roast's tastings and photo go with it (SPEC §6.2).
    async beforeRemove(roast) {
      const remaining = state.tastings.filter(t => t.roastId !== roast.id);
      if (remaining.length !== state.tastings.length) {
        commit("tastings", remaining);
        emit({ collection: "tastings", type: "remove", roastId: roast.id });
      }
      if (roast.photoId) {
        try { await photos.remove(roast.photoId); } catch (err) { console.warn("photo cleanup failed", err); }
      }
    },
  });
  roasts.getActive = async () => {
    const active = state.roasts.find(r => r.status === "active");
    return active ? clone(active) : null;
  };

  const tastings = collection("tastings", {
    filter: (t, { roastId }) => roastId == null || t.roastId === roastId,
  });

  const settings = {
    async get() { return clone(state.settings); },
    /** Merge a partial update; rejects (StoreError INVALID) without saving if any field is bad. */
    async save(patch) {
      const next = { ...state.settings, ...patch };
      const bad = invalidSettingsFields(next);
      if (bad.length) throw new StoreError("INVALID", `Invalid setting: ${bad.join(", ")}`);
      write(KEYS.settings, next);
      state.settings = next;
      emit({ collection: "settings", type: "save" });
      return clone(next);
    },
  };

  // Another tab of this app changed storage: reload and tell subscribers.
  function onStorage(e) {
    if (e.storageArea !== storage || (e.key !== null && !e.key.startsWith("roast-"))) return;
    try {
      load();
      emit({ collection: "*", type: "external" });
    } catch (err) {
      console.error("store reload failed", err);
    }
  }

  return {
    kind: "local",
    async init() {
      load();
      window.addEventListener("storage", onStorage);
    },
    beans,
    roasts,
    tastings,
    settings,
    photos,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
