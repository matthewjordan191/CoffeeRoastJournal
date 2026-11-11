# Coffee Roast Journal

Single-user PWA for logging home coffee roasts on a Fresh Roast SR800, used mainly on an iPhone. The product spec is [docs/SPEC.md](docs/SPEC.md). Read it before changing the data model or screens.

Conventions are modeled on the sibling repo `../CocktailRecipeRepository` (vanilla PWA on GitHub Pages, Firebase Auth + Firestore, local preview server, service worker). Look there for a working example of a pattern before you invent a new one.

## Working rules

- **Vanilla JS, CSS and HTML only.** Use native ES modules (`<script type="module">`, `import`/`export`). No framework, bundler, transpiler, npm build step or TypeScript. Every file in `web/` is served exactly as written.
- **Always ask before `git commit` or `git push`.** Never commit or push on your own initiative, even after a task is done. Show what changed and wait for a yes.
- **After any UI change, tell me to preview it** with `node scripts/serve.js` (http://localhost:8000) before committing. Do this every time the markup, styles or on-screen behavior changes.
- **Prefix every client-side storage name with `roast-`.** This app shares an origin (`matthewjordan191.github.io`) with the cocktail app, so its names must never collide with or clobber the cocktail app's. The rule covers:
  - `localStorage` / `sessionStorage` keys, e.g. `roast-beans`, `roast-settings`
  - service worker cache names, e.g. `roast-20261111120000`. In `activate`, delete only caches that start with `roast-`. Never touch other caches.
  - IndexedDB database names, if any (e.g. `roast-photos`)
- **Inputs must have a font size of at least 16px.** This applies to `input`, `select` and `textarea`. iOS Safari zooms the page when a smaller field gets focus.

## Layout (planned)

```
web/            the app (served as-is; GitHub Pages root)
  index.html
  app.js        entry module
  store/        store interface + localStorage and (later) Firestore backends
  sw.js         service worker; cache name "roast-<timestamp>"
  manifest.json
scripts/
  serve.js      local preview server (no-store headers, kill-switch sw.js)
docs/SPEC.md    product spec
firestore.rules owner-only rules (added with the Firestore backend)
```

## Notes

- Data access goes through the store module only. UI code never touches `localStorage` or Firestore directly. See SPEC § Architecture.
- Derived values (weight loss %, development time and ratio, time at each setting, days since roast, remaining stock) are computed on read and never persisted.
- Store canonical units (grams, °C, seconds). Convert to the user's chosen units only for display and input.
- Use Pointer Events and big tap targets on the live roast screen. It is used one-handed, next to a hot roaster.
