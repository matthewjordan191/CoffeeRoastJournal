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

1. **Start Roast** (from the Roasts screen) opens the setup sheet: bean, green weight (defaults to the batch weight in Settings), ambient temperature, extension tube (default **yes**), purpose and planned rest days, and starting fan and heat (default from Settings).
2. **Charge** starts the timer at t = 0. It records the `charge` milestone, plus one fan event and one heat event at t = 0 with the starting settings.
3. During the roast, big tap targets let me:
   - **Fan − / +** and **Heat − / +**. Each change logs a timestamped event with the new value.
   - Tap milestones: **Yellowing**, **First crack start**, **First crack end**, **Second crack**. Each can be recorded once. Tapping a recorded one again offers to move it to now.
   - **Display temp** (optional): type a reading, which is logged with the time.
   - **Note** (optional): free text, logged with the time.
   - **Undo** the last logged event, for mis-taps.
4. **Cool** ends the roast. It records the `cool` milestone and stops the development clock. Total time and development time end here.
5. **Cooling finished** (optional, after Cool) records `coolingDone`. Cooling time is `coolingDone − cool`.
6. The finish form collects roasted weight, roast level, rating, notes and photo. It can be completed later.

### 2.2 Live roast requirements

- **The timer must survive the app going to the background or the phone locking.** Store the charge moment as an absolute epoch time and compute elapsed as `now − chargeEpoch`. Never count ticks. Save the in-progress roast after every event, so a reload or crash resumes it.
- Request a **Screen Wake Lock** during a roast where supported, and degrade silently where not.
- Show elapsed time, the current fan and heat, the last milestone, and running development time once first crack has started.
- Only one roast can be in progress at a time. It can be discarded with a confirmation.
- Recorded events can be edited after the roast: adjust times, change values, delete events.

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
| `status` | `"active"` \| `"done"` | `active` while the timer is running |
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
| Remaining stock per bean | `Σ purchases.grams − Σ greenG of that bean's roasts` (active roast included) |
| Cost per roast | lot price per gram × `greenG`; approximate, using the bean's average price per gram |

## 5. Screens

Bottom tab bar: **Roasts · Beans · Tastings · Stats · Settings**.

- **Roasts.** History, newest first: bean name, date, level, weight loss %, DTR, rating, days since roast. A prominent **Start Roast** button. If a roast is active, a banner returns to it. Roast detail shows a timeline of milestones, control changes, temperature readings and notes, plus the derived values, with **Add tasting** and **Edit**.
- **Beans.** Active beans with remaining stock, with an archived toggle. Bean detail shows the purchases list (with **Add purchase**), the roasts of this bean, and the average tasting score.
- **Tastings.** List, newest first: bean, roast date, method, score, tags. Add a tasting from a chosen roast.
- **Stats.** Initial set: roast count and green weight roasted (all time and by month); stock on hand per bean; average weight loss by roast level; DTR vs. roast rating; average tasting score by bean and by days post-roast. Charts are inline SVG with no library.
- **Settings.** Units, default batch weight, default starting fan and heat, sign-in status.

## 6. Architecture

### 6.1 Stack

- Vanilla JS with native ES modules, CSS and HTML. No build step. Hosted on GitHub Pages from `web/`.
- The service worker caches the app shell. The cache name is `roast-<timestamp>`, and `activate` deletes only `roast-*` caches, because the origin is shared with the cocktail app.
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
store.roasts.list() / get(id) / save(roast) / remove(id)   // remove also deletes its tastings and photo, after confirmation in the UI
store.roasts.getActive()              // the roast with status "active", or null
store.tastings.list({ roastId? }) / get(id) / save(t) / remove(id)
store.settings.get() / save(settings)
store.photos.put(blob) → photoId / get(photoId) → Blob | null / remove(photoId)
store.subscribe(callback)             // fires after any change; returns an unsubscribe function
```

- **localStorage backend (now).** Keys are `roast-beans`, `roast-roasts`, `roast-tastings`, `roast-settings` and `roast-schema` (the data version, for migrations). Each holds a JSON array or object. Every `save` of the active roast writes through immediately.
- **Firestore backend (later).** Collections `users/{uid}/beans`, `users/{uid}/roasts` and `users/{uid}/tastings`, and the document `users/{uid}/meta/settings`. Offline persistence is enabled. On first sign-in, a one-time import copies localStorage data up if the cloud is empty.
- Derived values live in a separate pure module (`web/derive.js`), never in either backend.

### 6.3 Photos

There is one photo per roast. It is downscaled on the device to about 1600 px on the long edge, as JPEG, before saving. localStorage is too small for images, so the local backend keeps photo blobs in **IndexedDB** (database `roast-photos`), keyed by `photoId`. The Firestore phase moves them to Firebase Storage under `users/{uid}/photos/{photoId}`.

### 6.4 iOS details

- Inputs, selects and textareas use a font size of at least 16px, so iOS does not zoom.
- Number fields use `inputmode="decimal"`.
- The layout respects `env(safe-area-inset-*)`.
- Live-roast tap targets are at least 56 px.

## 7. Later / out of scope for v1

- JSON export and import for backup.
- Overlaying several roasts' fan/heat timelines to compare them.
- Rest-day reminders.
