// The in-progress roast (SPEC §3.2.1). It lives in its own localStorage key
// under EVERY backend: each live tap is then a synchronous local write that
// works offline and can't be delayed by sync. Only finish() touches the
// backend, through roasts.save().
import { StoreError } from "./local.js";

export const ACTIVE_KEY = "roast-active";

export function createActiveStore({ storage, roasts, emit }) {
  function read() {
    const raw = storage.getItem(ACTIVE_KEY);
    if (raw == null) return null;
    let value;
    try { value = JSON.parse(raw); } catch { value = null; }
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !Number.isFinite(value.chargedAt)) {
      // Reported, not deleted: it's the only copy of a roast in progress.
      throw new StoreError("CORRUPT", `The roast in progress ("${ACTIVE_KEY}") is unreadable.`);
    }
    return value;
  }

  function write(active) {
    try {
      storage.setItem(ACTIVE_KEY, JSON.stringify(active));
    } catch (err) {
      throw new StoreError("WRITE_FAILED", `Couldn't save the roast in progress (${err?.name || "storage error"}).`);
    }
  }

  return {
    /** The roast in progress, or null. */
    async get() {
      return read();
    },

    /** Rewrite it after every live action. Synchronous under the hood. */
    async save(active) {
      if (!active || typeof active.id !== "string" || !Number.isFinite(active.chargedAt)) {
        throw new TypeError("active.save expects an in-progress roast with id and chargedAt");
      }
      write(active);
      emit({ collection: "active", type: "save", id: active.id });
      return active;
    },

    /** Throw it away. Writes no Roast. */
    async discard() {
      storage.removeItem(ACTIVE_KEY);
      emit({ collection: "active", type: "discard" });
    },

    /**
     * At Cool: save the finished Roast (built by roast-session toRoast), THEN
     * remove the key — a crash in between leaves both, and init() cleans up.
     */
    async finish(roast) {
      const current = read();
      if (!current || current.id !== roast?.id) {
        throw new StoreError("NO_ACTIVE", "There's no roast in progress to finish.");
      }
      const saved = await roasts().save(roast);
      storage.removeItem(ACTIVE_KEY);
      emit({ collection: "active", type: "finish", id: roast.id });
      return saved;
    },

    /** Startup: a roast-active already saved as a Roast is left over from a crash at Cool. */
    async cleanup() {
      let current;
      try { current = read(); } catch { return; } // corrupt: leave it for the user to see
      if (current && (await roasts().get(current.id))) storage.removeItem(ACTIVE_KEY);
    },
  };
}
