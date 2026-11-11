// Screen Wake Lock for the live roast (SPEC §2.2). Never fails silently:
// every state other than "held" is reported so the screen can warn.
//
//   const lock = createWakeLock(state => …);  // "held" | "lost" | "refused" | "unsupported"
//   lock.start();   // request now, and again whenever the app comes back to the foreground
//   lock.retry();   // e.g. on a tap — some browsers only grant it after a user gesture
//   lock.stop();    // release; stop listening

export function createWakeLock(onChange) {
  let sentinel = null;
  let running = false;
  let state = null;
  let pending = false;

  const set = next => {
    if (next !== state) { state = next; onChange(next); }
  };

  async function request() {
    if (!running || sentinel || pending) return;
    if (!("wakeLock" in navigator)) { set("unsupported"); return; }
    if (document.visibilityState !== "visible") { set("lost"); return; }
    pending = true;
    try {
      const s = await navigator.wakeLock.request("screen");
      if (!running) { s.release().catch(() => {}); return; }
      sentinel = s;
      s.addEventListener("release", () => {
        if (sentinel === s) sentinel = null;
        if (running) set("lost");   // iOS releases it when the app goes to the background
      });
      set("held");
    } catch {
      set("refused");
    } finally {
      pending = false;
    }
  }

  function onVisibility() {
    if (document.visibilityState === "visible") request();
    else if (running && !sentinel) set("lost");
  }

  return {
    start() {
      if (running) return;
      running = true;
      document.addEventListener("visibilitychange", onVisibility);
      request();
    },
    retry() {
      if (state !== "held" && state !== "unsupported") request();
    },
    stop() {
      running = false;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinel;
      sentinel = null;
      s?.release().catch(() => {});
    },
    get state() { return state; },
  };
}
