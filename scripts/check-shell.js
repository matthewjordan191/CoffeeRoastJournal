// Check that APP_SHELL in web/sw.js matches the files in web/:
//   node scripts/check-shell.js
// A listed file that doesn't exist makes cache.addAll() reject, which fails
// the service worker install — installed copies would silently never update.
// A file missing from the list wouldn't be available offline.
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "web");
const sw = fs.readFileSync(path.join(WEB, "sw.js"), "utf8");

const block = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!block) { console.error("APP_SHELL not found in web/sw.js"); process.exit(1); }
const listed = [...block[1].matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]).filter(Boolean); // "./" itself is the page

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [path.relative(WEB, full).split(path.sep).join("/")];
  });
}
const onDisk = walk(WEB).filter(f => f !== "sw.js");

const missing = listed.filter(f => !onDisk.includes(f));
const unlisted = onDisk.filter(f => !listed.includes(f));

for (const f of missing) console.error(`listed in APP_SHELL but not in web/: ${f}`);
for (const f of unlisted) console.error(`in web/ but not listed in APP_SHELL: ${f}`);
if (missing.length || unlisted.length) process.exit(1);
console.log(`APP_SHELL OK (${listed.length} files)`);
