// Photo blobs live in IndexedDB — localStorage is far too small for images.
// The database name carries the "roast-" prefix because the origin is shared
// with the cocktail app. Callers downscale before calling put() (SPEC §6.3).
import { newId } from "./ids.js";

const DB_NAME = "roast-photos";
const STORE = "photos";

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(err => { dbPromise = null; throw err; }); // allow a retry later
  return dbPromise;
}

async function run(mode, op) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const photos = {
  /** Store a Blob; resolves to its new photoId. */
  async put(blob) {
    if (!(blob instanceof Blob)) throw new TypeError("photos.put expects a Blob");
    const id = newId();
    await run("readwrite", s => s.put(blob, id));
    return id;
  },
  /** Resolves to the Blob, or null if there is none. */
  async get(id) {
    if (!id) return null;
    return (await run("readonly", s => s.get(id))) ?? null;
  },
  async remove(id) {
    if (!id) return;
    await run("readwrite", s => s.delete(id));
  },
};
