# Coffee Roast Journal

Single-user PWA for logging home coffee roasts on a Fresh Roast SR800, used mainly on an iPhone. The product spec is [docs/SPEC.md](docs/SPEC.md). Read it before changing the data model or screens.

Conventions are modeled on the sibling repo `../CocktailRecipeRepository` (vanilla PWA on GitHub Pages, Firebase Auth + Firestore, local preview server, service worker). Look there for a working example of a pattern before you invent a new one.

## Working rules

- **Vanilla JS, CSS and HTML only.** Use native ES modules (`<script type="module">`, `import`/`export`). No framework, bundler, transpiler, npm build step or TypeScript. Every file in `web/` is served exactly as written.
- **Always ask before `git commit`.** Never commit on your own initiative, even after a task is done. Show what changed and wait for a yes. **Once I confirm a commit, push it right away** (`git push`) without asking again. Never push commits I didn't confirm.
- **After any UI change, tell me to preview it** with `node scripts/serve.js` (http://localhost:8000) before committing. Do this every time the markup, styles or on-screen behavior changes.
- **Prefix every client-side storage name with `roast-`.** This app shares an origin (`matthewjordan191.github.io`) with the cocktail app, so its names must never collide with or clobber the cocktail app's. The rule covers:
  - `localStorage` / `sessionStorage` keys, e.g. `roast-beans`, `roast-settings`
  - service worker cache names, e.g. `roast-3f2a9c1b7d0e`. In `activate`, delete only caches that start with `roast-`. Never touch other caches.
  - IndexedDB database names, if any (e.g. `roast-photos`)
- **Inputs must have a font size of at least 16px.** This applies to `input`, `select` and `textarea`. iOS Safari zooms the page when a smaller field gets focus.

## Layout

```
web/              the app (served as-is; GitHub Pages root)
  index.html      shell: #view + #tabbar + #toast
  app.js          entry module: builds tab bar, store.init(), starts router
  router.js       hash routes "#/<screen>/<params…>"; screens export title + render(root, {params}); navigate(), goBack(fallback)
  ui.js           h() DOM helper, icons, shared controls (segmented, stepper, toast)
  units.js        g/oz and °C/°F conversion + formatting (weights, money, dates)
  derive.js       derived values (SPEC §4): pure functions, never persisted
  roast-session.js  live-roast state changes (taps, merging, undo, toRoast): pure functions
  wakelock.js     Screen Wake Lock with state reporting; image.js photo downscaling
  screens/        one module per tab; a tab's sub-pages are sibling modules (bean-detail, bean-form, purchase-form,
                  roast-finish); roast.js is a screen without a tab (#/roast/new setup, #/roast/live, full screen)
  store/          index.js (interface) · local.js (localStorage) · active.js (roast-active) · settings.js · photos.js (IndexedDB) · ids.js
tests/            node --test unit tests for derive.js and roast-session.js (no dependencies; not served)
  sw.js           service worker; cache "roast-dev" in the repo, stamped at deploy
  manifest.json, icon.svg, icon-192/512.png, apple-touch-icon.png
scripts/
  serve.js        local preview server (no-store headers, kill-switch sw.js)
  make-icons.js   renders web/icon.svg → PNGs via headless Chrome/Edge
  check-shell.js  fails if APP_SHELL in sw.js and the files in web/ disagree
.github/workflows/deploy.yml   on push to main: check-shell → node --test → stamp cache → deploy web/ to Pages
docs/SPEC.md      product spec
```

## Deployment

- **Every push to `main` deploys** to https://matthewjordan191.github.io/CoffeeRoastJournal/ through GitHub Actions.
- **The service worker cache name is stamped at deploy time.** `web/sw.js` keeps the literal `const CACHE = "roast-dev";`, and the workflow rewrites it to `roast-<first 12 chars of commit SHA>`. Don't edit that line by hand, and don't add a pre-commit hook for it. The deploy fails if the placeholder is missing.
- **When you add, rename or delete a file under `web/`, update `APP_SHELL` in `web/sw.js`.** Run `node scripts/check-shell.js` to check. The deploy runs it too and fails on any mismatch.
- Screens build DOM with `h()` and text nodes. Never put user data into `innerHTML`.
- Use `mount(parent, …)` from `ui.js`, not `parent.append(…)`, whenever a child may be `null`. `append` renders a null child as the text "null".
- Sub-pages use `subHeader({ backLabel, onBack: () => goBack(parentRoute) })`. After saving a form, use `goBack()`; after creating a record, use `navigate(…, { replace: true })`. That keeps forms out of the Back history.

## Tests

- **Run `node --test` before committing** logic changes. It runs `tests/*.test.mjs` with no dependencies, and the deploy fails if any test fails.
- Keep the logic that's easy to get wrong in pure modules (`derive.js`, `roast-session.js`): no DOM, no store, time passed in as `nowMs`. Then it can be tested here.

## Notes

- Data access goes through the store module only. UI code never touches `localStorage` or Firestore directly. See SPEC § Architecture.
- Derived values (weight loss %, development time and ratio, time at each setting, days since roast, remaining stock) are computed on read and never persisted.
- Store canonical units (grams, °C, seconds). Convert to the user's chosen units only for display and input.
- Use Pointer Events and big tap targets on the live roast screen. It is used one-handed, next to a hot roaster. Its targets are at least 56 px with at least 8 px gaps. Anything destructive needs a hold (`holdButton`) or an in-app `confirmSheet`, never `window.confirm`.
- Live-roast time is always `Date.now() − chargedAt`. Never count timer ticks; intervals only repaint.
