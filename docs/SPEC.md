# Coffee Roast Journal — Spec

A personal PWA for logging coffee roasts on a Fresh Roast SR800, tracking green coffee stock, and recording tastings. Used mainly as an installed home-screen app on an iPhone.

## 1. Users and access

- **One user (me).** There is no sharing, no social features and no community data.
- **Google sign-in** through Firebase Auth, as in the cocktail app.
- **All data is private.** Firestore rules allow reads and writes only under `users/{uid}/…` where `request.auth.uid == uid`. Everything else is denied. The rules can optionally be pinned to my single uid as well.
- Until the Firestore backend exists, the app runs **local-only** from localStorage, with no sign-in gate. `scripts/serve.js` previews in this mode by default, as in the cocktail app.

## 2. The roaster

- **Fresh Roast SR800** with an **extension tube**. It has no data logging, so everything is entered by hand on a live timer.
- **Controls:** fan 1–9 and heat 1–9, both integers.
- **Display temperature:** the SR800 shows a chamber/exhaust temperature reading. The app calls it **display temperature** everywhere and never "bean temperature".

### 2.1 Live roast flow

1. **Start Roast** (from the Roasts screen) opens the setup sheet (`#/roast/new`): bean, green weight (defaults to the batch weight in Settings), ambient temperature, extension tube (default **yes**), purpose and planned rest days, and starting fan and heat (default from Settings). **Roast this again** opens the same sheet pre-filled from an earlier roast (§2.3).
2. **Charge** starts the timer at t = 0, creates the in-progress roast in `roast-active` (§3.2.1) and opens the live screen (`#/roast/live`), replacing setup in the Back history. It records the `charge` milestone, plus one fan event and one heat event at t = 0 with the starting settings.
3. During the roast, big tap targets let me:
   - **Fan − / +** and **Heat − / +**. Each change logs a timestamped event with the new value. Rapid taps are merged (§2.2).
   - Tap milestones: **Yellowing**, **First crack start**, **First crack end**, **Second crack**. Each can be recorded once. Tapping a recorded one again offers to move it to now.
   - **Display temp** (optional): type a reading, which is logged with the time.
   - **Note** (optional): free text, logged with the time.
   - **Undo** the last logged event, for mis-taps.
4. **Cool** ends the roast. It is a **press-and-hold** button (about 0.8 s), so a brush can't end a roast. The `cool` time is taken from when the press *started*. It records the `cool` milestone and stops the development clock. Total time and development time end here. **This is the moment the roast is written to the store** as a Roast record, and `roast-active` is cleared (§3.2.1).
5. **Cooling is always 3:00 on the SR800**, so Cool also records `coolingDone` at `cool + 180 s`. There's nothing to tap. After Cool the app opens the finish form (`#/roasts/<id>/finish`), which shows a 3:00 countdown that stops by itself. Cooling time is `coolingDone − cool`. Fan or heat changes during cooling aren't logged in v1, because the roast is already saved at Cool.
6. The finish form collects roasted weight, roast level, rating, notes and photo. It can be completed later. **The photo works locally from the first build of the live roast.** It is taken with the camera or chosen from the library, downscaled on the device, and saved in IndexedDB (§6.3). It does not wait for Firebase.

### 2.2 Live roast requirements

- **The timer must survive the app going to the background or the phone locking.** Store the charge moment as an absolute epoch time and compute elapsed as `now − chargedAt`. Never count ticks. Write the in-progress roast to `roast-active` after every event, so a reload or crash resumes it.
- **Screen Wake Lock:** request it at Charge. If the API is missing, the request is refused, or the lock is lost, show a **visible warning on the live screen**. The lock is lost, for example, when the app goes to the background, and iOS releases it then. The warning reads like "Screen may lock — keep it awake by tapping it, or set Auto-Lock to Never". Never degrade silently. When the app becomes visible again, re-request the lock, and remove the warning once it's held. (Home Screen web apps on iOS only support the lock from iOS 18.4, so expect the warning on older versions.)
- **Merging rapid fan/heat taps:** taps on the same control less than about **2 s** apart count as one change.
  - The first tap of a burst logs the ControlEvent at its own time. Each further tap updates that event's `value`, and the 2 s window restarts from the latest tap.
  - If the burst ends on the value it started from, the event is dropped.
  - Fan taps and heat taps are merged separately.
  - The display shows each new value immediately. The event is updated in `roast-active` on every tap, so a crash in the middle of a burst loses nothing.
- **Full screen:** the live roast is its own route (`#/roast/live`), and **the tab bar is hidden** while it's shown. Leaving it (Back, or a Minimize button) does not stop the roast. The Roasts screen shows a banner that returns to it.
- Show elapsed time, the current fan and heat, the last milestone, and running development time once first crack has started.
- Only one roast can be in progress at a time, because there is a single `roast-active` key. It can be discarded with a confirmation, which removes the key and writes nothing.
- Recorded events can be edited after the roast (`#/roasts/<id>/edit`): adjust times, change values, delete events, add missing ones. Times are typed as m:ss. Bare digits also work (`740` → 7:40), because the iPhone number pad has no colon. Untouched times keep their stored 0.1 s precision. Cool is required. Milestones must be after charge and before Cool, in order: Yellowing < FC < FC end, and FC < Second crack. Saving keeps `coolingDone` at Cool + 3:00 and `totalTimeS` equal to Cool.

### 2.3 Roast this again

**Roast this again** is on each roast's detail page on the Roasts screen. It starts a new roast that uses the earlier roast as a plan:

- **Setup is pre-filled** with the same bean, the same green weight, and the earlier roast's starting fan and heat (its t = 0 events, not the Settings defaults). Every field stays editable. If that bean is archived or doesn't have enough stock left, show a warning without blocking.
- **Milestone targets:** each milestone button shows the earlier roast's time for it as a target (e.g. "FC target 7:40"). Once tapped, it also shows the difference (e.g. "+0:12").
- **Fan/heat prompts:** about **15 s before** each fan or heat change the earlier roast made after t = 0 (and before its Cool), show a prompt such as "In 15 s: Heat → 7", with a countdown. The prompt clears when I make that change, or about 10 s after its planned time. Prompts are visual. They sit in a fixed-height slot that otherwise shows the next planned change, so nothing on the screen moves when a prompt appears. An optional chime can be turned on from the live screen (saved as `promptChime` in Settings). iOS web apps can't vibrate.
- **Route:** `#/roast/new/<earlier roast id>`.
- The plan (the earlier roast's id) is held only in `roast-active`, and is not saved on the finished Roast.

## 3. Data model

Conventions:
- IDs are `crypto.randomUUID()` strings.
- Every record has `createdAt` and `updatedAt` (epoch ms).
- **Canonical units:** grams, °C and seconds. Values are converted to the units in Settings only for display and input.
- Dates without a time (purchase date, tasting date) are `YYYY-MM-DD` strings. The roast date is the charge time, stored as epoch ms.
- Optional fields are `null` when unset.

### 3.1 Bean

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | required |
| `origin` | string | country |
| `region` | string | |
| `producer` | string | farm, estate or co-op |
| `variety` | string | e.g. "Bourbon, Caturra" |
| `process` | string | washed, natural, honey, anaerobic… (suggestions plus free text) |
| `altitudeM` | number \| null | growing elevation in metres; a range can go in notes |
| `cropYear` | number \| null | harvest year |
| `moisturePct` | number \| null | green moisture, if the supplier lists it |
| `purchases` | Purchase[] | one entry per bag bought (see below) |
| `notes` | string | |
| `archived` | boolean | hidden from pickers and the default list; never deleted while roasts reference it |

**Purchase** (a lot within a bean):

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `supplier` | string | |
| `date` | `YYYY-MM-DD` | purchase date |
| `grams` | number | green weight bought |
| `price` | number \| null | total paid for this lot, in dollars |

Buying the same coffee again adds a purchase to the existing bean, so its roast history stays together.

### 3.2 Roast

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `beanId` | string | reference to Bean |
| `beanName` | string | **snapshot** of the bean name at roast time, so history reads correctly even if the bean is renamed |
| `chargedAt` | number | epoch ms of charge; this is the roast date |
| `greenG` | number | green weight |
| `roastedG` | number \| null | roasted weight, entered after cooling |
| `ambientC` | number \| null | ambient temperature |
| `extensionTube` | boolean | default `true` |
| `purpose` | string \| null | intended brew method: espresso, filter, French press, cold brew… |
| `restDaysPlanned` | number \| null | planned rest before first use |
| `milestones` | Milestone[] | see below |
| `controlEvents` | ControlEvent[] | fan and heat changes, including the starting values at t = 0 |
| `displayTemps` | TempReading[] | optional |
| `notesLog` | TimedNote[] | optional timestamped notes from the live screen |
| `totalTimeS` | number \| null | set when Cool is pressed; always equals the `cool` milestone's `t` |
| `roastLevel` | RoastLevel \| null | see below |
| `rating` | 1–5 \| null | integer stars |
| `notes` | string | general notes, written after the roast |
| `photoId` | string \| null | reference to a stored photo (see §6.3) |

```js
// t = seconds from charge (number; stored to 0.1 s)
Milestone    = { type: "charge" | "yellowing" | "fcStart" | "fcEnd" | "sc" | "cool" | "coolingDone", t }
ControlEvent = { t, control: "fan" | "heat", value: 1..9 }   // value = the NEW setting
TempReading  = { t, displayC }                                // SR800 display temp, not bean temp
TimedNote    = { t, text }
RoastLevel   = "Cinnamon" | "City" | "City+" | "Full City" | "Full City+" | "Vienna" | "French"
```

Rules:
- `charge` is always at t = 0, and the fan and heat events at t = 0 are always present.
- Each milestone type appears at most once.
- `controlEvents` are kept sorted by `t`. Changes after `cool` are allowed (fan during cooling) but are excluded from time-at-setting stats.
- Every saved Roast is a finished roast: it always has a `cool` milestone and `totalTimeS`. A roast in progress is never a Roast record.

### 3.2.1 In-progress roast (`roast-active`)

The roast being timed lives in its **own localStorage key, `roast-active`, under every backend**, including Firestore later. Each tap is then a synchronous local write that works offline and can't be delayed by sync. The key holds one JSON object or is absent.

```js
ActiveRoast = {
  id,                 // generated at Charge; becomes the Roast's id at Cool
  beanId, beanName, greenG, ambientC, extensionTube, purpose, restDaysPlanned,
  chargedAt,          // epoch ms
  milestones, controlEvents, displayTemps, notesLog,   // same shapes as Roast
  planRoastId,        // null, or the earlier roast for "Roast this again" (§2.3)
  lastTap,            // { fan, heat }: each { at, startValue, t } for that control's open merge window (§2.2), or null
  undo,               // stack of snapshots for Undo (max 30), so Undo survives a reload
}
```

- **Charge** creates it. **Every event** rewrites it. **Discard** removes it.
- **Cool** turns it into a Roast: record `cool`, set `totalTimeS`, drop `planRoastId`, `lastTap` and `undo`. The pure `toRoast()` in `web/roast-session.js` builds the record, and `store.active.finish(roast)` saves it with `store.roasts.save()`, then removes `roast-active`.
- **Crash safety:** if the app dies between that save and the removal, startup finds a `roast-active` whose `id` already exists in `roasts` and removes it. The roast is never duplicated.
- No other screen writes to it. It isn't exported (§5) or synced.

### 3.3 Tasting

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `roastId` | string | reference to Roast |
| `date` | `YYYY-MM-DD` | |
| `brewMethod` | string | espresso, V60, AeroPress, French press… (suggestions plus free text) |
| `doseG` | number \| null | coffee in |
| `waterG` | number \| null | water in (or beverage out, for espresso) |
| `grind` | string | grinder and setting, free text, e.g. "Comandante 22" |
| `flavorTags` | string[] | free tags; suggestions come from tags already used plus a starter list |
| `score` | number \| null | **1–10 in 0.5 steps** |
| `notes` | string | |

### 3.4 Settings

| Field | Type | Default |
|---|---|---|
| `weightUnit` | `"g"` \| `"oz"` | `"g"` |
| `tempUnit` | `"F"` \| `"C"` | `"F"` |
| `defaultBatchG` | number | `225` |
| `defaultFan` | 1–9 | `9` |
| `defaultHeat` | 1–9 | `1` |
| `promptChime` | boolean | `false`: chime with "Roast this again" prompts (§2.3), toggled on the live screen |

## 4. Derived values (computed, never stored)

| Value | Formula |
|---|---|
| Weight loss % | `(greenG − roastedG) / greenG × 100`; null without `roastedG` |
| Development time | `cool.t − fcStart.t`; null without first crack |
| Development ratio (DTR) | `development time / totalTimeS × 100` |
| Phase times | drying = charge → yellowing; Maillard = yellowing → fcStart; development as above |
| Time at each setting | Walk `controlEvents` up to `cool`. Each fan value and each heat value accumulates the time until the next change of that control. Also report time per (fan, heat) pair. |
| Days since roast | today − local date of `chargedAt`; "ready" once it is ≥ `restDaysPlanned` |
| Days post-roast at tasting | tasting `date` − roast date |
| Brew ratio | `waterG / doseG` (shown as 1:x) |
| Remaining stock per bean | `Σ purchases.grams − Σ greenG of that bean's saved roasts − (greenG of the in-progress roast, if it uses this bean)` |
| Cost per roast | lot price per gram × `greenG`; approximate, using the bean's average price per gram |

## 5. Screens

Bottom tab bar: **Roasts · Beans · Tastings · Stats · Settings**. It is hidden on the live roast screen (§2.2).

- **Roasts.** History, newest first: bean name, date, total time, DTR, level, rating, days since roast ("Day 1 of 3" while still resting), and weight loss % (or **Unfinished**). Rows open the roast detail. There's a prominent **Start Roast** button and a **Log a past roast by hand** link. While `roast-active` exists, a banner returns to the live screen.
  - **Roast detail** (`#/roasts/<id>`): the photo, the derived values (§4, including time at each setting and cost), one merged timeline of milestones, fan/heat changes, display temps and notes, and a link to the bean. It has **Edit** (§2.2), **Finish details** (the finish form), **Roast this again** (§2.3), and **Delete** with an in-app confirmation. Deleting also removes the roast's tastings and photo, and returns its green weight to stock. **Add tasting** and **Compare** come with the Tastings and Compare work.
  - **Log a past roast** (`#/roasts/log`): the same editor, for backfilling. Pick the bean, the date and time, and the green weight. Type the milestone times and the starting fan/heat, then add fan/heat changes, display temps and timed notes. Saving opens the finish form for the results.
  - **Compare overlay:** pick up to 4 roasts. Earlier roasts of the same bean are suggested first. Their fan and heat settings are drawn as step lines over time, with milestone markers, all aligned at charge. A toggle aligns them at first crack start instead. Below the chart is a table of milestone times, development time, DTR and weight loss side by side. Inline SVG, no library.
- **Beans.** Active beans with remaining stock, with an archived toggle. Bean detail shows the purchases list (with **Add purchase**), the roasts of this bean, and the average tasting score.
- **Tastings.** List, newest first: bean, roast date, method, score, tags. Add a tasting from a chosen roast.
- **Stats.** Initial set: roast count and green weight roasted (all time and by month); stock on hand per bean; average weight loss by roast level; DTR vs. roast rating; average tasting score by bean and by days post-roast. Charts are inline SVG with no library.
- **Settings.** Units, default batch weight, default starting fan and heat, sign-in status, and **Data: Export / Import**.
  - **Export:** one JSON file, `roast-journal-YYYY-MM-DD.json`, containing `{ app: "roast-journal", schemaVersion, exportedAt, settings, beans, roasts, tastings, photos }`. `photos` maps `photoId` to a JPEG data URL. An "Include photos" toggle (default on) leaves them out to keep the file small. On iPhone the file goes to the share sheet (Save to Files), with a download link as the fallback.
  - **Import:** pick a file. It is validated (app name, `schemaVersion` not newer than the app's, record shapes), then a preview shows the counts before anything is written. **Merge** (the default) upserts by `id`, and the newer `updatedAt` wins. **Replace all** deletes everything first and needs a second confirmation. Import is refused while a roast is in progress, and `roast-active` is never imported.

## 6. Architecture

### 6.1 Stack

- Vanilla JS with native ES modules, CSS and HTML. No build step. Hosted on GitHub Pages from `web/`.
- The service worker caches the app shell. The deploy workflow stamps the cache name as `roast-<commit sha>`. `activate` deletes only `roast-*` caches, because the origin is shared with the cocktail app.
- **Updates are never applied by reloading on their own.** When a new service worker takes control of an open page, show a persistent **"New version ready — tap to reload"** toast. Only a tap reloads. The first install, when no worker was in control before, shows nothing.
- The Firebase SDK comes later, as the modular ES-module build imported from gstatic at a pinned version and precached for offline boot.

### 6.2 Store module

All persistence goes through one interface (`web/store/index.js`). It selects a backend at startup. UI modules import only the store.

```js
// every method is async (returns a Promise), so both backends fit
store.init()                          // load or attach; resolves when ready
store.beans.list({ includeArchived }) // Bean[]
store.beans.get(id)                   // Bean | null
store.beans.save(bean)                // upsert; sets id, timestamps; returns the saved record
store.beans.remove(id)                // refused if roasts reference it (archive instead)
store.roasts.list() / get(id) / save(roast) / remove(id)   // finished roasts only; remove also deletes its tastings and photo, after confirmation in the UI
store.active.get()                    // ActiveRoast | null, read from roast-active
store.active.save(activeRoast)        // rewrite roast-active (every live event)
store.active.discard()                // remove roast-active; writes no Roast
store.active.finish(roast)            // at Cool: save the Roast built by toRoast(), then remove roast-active; returns it
store.tastings.list({ roastId? }) / get(id) / save(t) / remove(id)
store.settings.get() / save(settings)
store.photos.put(blob) → photoId / get(photoId) → Blob | null / remove(photoId)
store.exportAll({ includePhotos })    // → export object (§5 Settings)
store.importAll(data, { mode })       // mode "merge" | "replace"; validates first; refused while roast-active exists
store.subscribe(callback)             // fires after any change; returns an unsubscribe function
```

- **`store.active` is the same code under every backend.** It always reads and writes localStorage `roast-active`. Only `finish()` touches the backend, through `roasts.save()`. On init, a `roast-active` whose `id` is already in `roasts` is removed (§3.2.1).
- **localStorage backend (now).** Keys are `roast-beans`, `roast-roasts`, `roast-tastings`, `roast-settings`, `roast-active` and `roast-schema` (the data version, for migrations). Each holds a JSON array or object.
- **Firestore backend (later).** Collections `users/{uid}/beans`, `users/{uid}/roasts` and `users/{uid}/tastings`, and the document `users/{uid}/meta/settings`. Offline persistence is enabled. On first sign-in, a one-time import copies localStorage data up if the cloud is empty.
- Derived values live in a separate pure module (`web/derive.js`), never in either backend. Live-roast state changes (tap merging, undo, Cool) are pure functions in `web/roast-session.js`. Both are unit-tested with `node --test` (`tests/`).

### 6.3 Photos

There is one photo per roast. It is picked with `<input type="file" accept="image/*">`, which on iPhone offers the camera or the library. It is downscaled on the device to about 1600 px on the long edge, as JPEG, before saving.

- **Photos work locally from the first build of the live roast.** Blobs are stored in **IndexedDB** (database `roast-photos`), keyed by `photoId`. localStorage is too small for images.
- **IndexedDB stays the photo store under every backend.** The Firestore phase only adds sync: it uploads each photo to Firebase Storage at `users/{uid}/photos/{photoId}`, and downloads any missing ones into IndexedDB on other devices. Photos never depend on being signed in.

### 6.4 iOS details

- Inputs, selects and textareas use a font size of at least 16px, so iOS does not zoom.
- Number fields use `inputmode="decimal"`.
- The layout respects `env(safe-area-inset-*)`.
- Live-roast tap targets are at least 56 px.

## 7. Later / out of scope for v1

- Rest-day reminders.

The compare overlay and JSON export/import were moved into v1 (§5).
