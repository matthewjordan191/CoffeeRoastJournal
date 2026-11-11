// Local preview server: node scripts/serve.js  →  http://localhost:8000
// Serves web/ with no-store headers so you always see your working tree.
// Adapted from CocktailRecipeRepository/scripts/serve.js.
//
// The app is local-only for now (localStorage backend, no sign-in), so
// there is no Firebase stripping yet. When the Firestore backend lands, add
// a local-only/--firebase switch here as the cocktail app does.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "web");
const PORT = Number(process.env.PORT) || 8000;

// Served instead of the real sw.js: a service worker installed by an
// earlier preview would otherwise serve its cache-first copy of the app and
// you'd never see your edits. This stub takes over, deletes this app's
// caches, and unregisters itself — after one reload the page talks straight
// to this server. Only "roast-" caches are deleted: on localhost:8000 the
// cocktail app's preview shares the same origin.
const KILL_SW = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("roast-")).map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.claim())
));
`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400); res.end(); return;
  }
  if (p.endsWith("/")) p += "index.html";
  if (p === "/sw.js") {
    res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
    res.end(KILL_SW);
    return;
  }
  const file = path.normalize(path.join(ROOT, p));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store", // dev: always serve the working tree
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Preview of web/ at http://localhost:${PORT}`);
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
  for (const ip of lan) console.log(`  on your phone (same Wi-Fi): http://${ip}:${PORT}`);
  console.log("Mode: local-only — data lives in this browser's localStorage.");
  console.log("Tip: a private window avoids stale files from an old service worker.");
});
