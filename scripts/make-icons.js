// Render web/icon.svg to the PNG icons the manifest and iOS need:
//   node scripts/make-icons.js
// Uses headless Chrome or Edge (no npm packages). Set CHROME=/path/to/browser
// if it isn't found automatically.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const WEB = path.join(__dirname, "..", "web");
const SVG = path.join(WEB, "icon.svg");
const OUTPUTS = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180], // iOS home screen; opaque, iOS rounds the corners
];

const CANDIDATES = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const browser = CANDIDATES.find(p => fs.existsSync(p));
if (!browser) {
  console.error("No Chrome/Edge found. Set CHROME=/path/to/browser.");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roast-icons-"));
try {
  for (const [name, size] of OUTPUTS) {
    const html = path.join(tmp, `${size}.html`);
    fs.writeFileSync(html,
      `<!doctype html><html><body style="margin:0;background:#14110f">` +
      `<img src="${pathToFileURL(SVG)}" width="${size}" height="${size}" style="display:block"></body></html>`);
    const out = path.join(WEB, name);
    execFileSync(browser, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      `--user-data-dir=${path.join(tmp, "profile")}`,
      `--window-size=${size},${size}`, `--screenshot=${out}`, pathToFileURL(html).href,
    ], { stdio: "ignore" });
    const png = fs.readFileSync(out);
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    if (w !== size || h !== size) throw new Error(`${name}: got ${w}×${h}, expected ${size}×${size}`);
    console.log(`wrote web/${name} (${size}×${size})`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
