# Carry-over plan: port two features from wohnungssuche into Fredy

**Status:** Planning complete, scope confirmed, implementation not started.
**Source repo studied:** https://github.com/ganainy/wohnungssuche (the user's own
single-portal Immowelt crawler). Read `AGENTS.md` in this repo first — it documents
Fredy's architecture and is required reading before touching any of this.

## Why this doc exists

The user asked to "merge the features" of wohnungssuche into Fredy. After reading
wohnungssuche's source in full, almost everything it does is already covered by Fredy
(see "Rejected / already covered" below) — porting those would be redundant or a
downgrade. Only two features are genuine gaps. This file is the carry-over brief so a
fresh session can start implementing without re-deriving the comparison.

## Confirmed scope (user selected both)

1. **Apply-automation button** (bigger feature)
2. **Traffic-aware car travel time** (smaller feature)

Portal scope for #1 was not explicitly confirmed by the user (the question was asked
but not answered in a readable way) — default to **ImmoScout24 first**, add **Immowelt**
second if the user wants it. Confirm with the user before generalizing further; do not
attempt all 29 providers.

---

## Feature 1: Apply-automation button

### What it does

Today, Fredy's listing detail page has "Copy application letter" (generates text from
`lib/services/application/*`, user pastes it manually into the portal's contact form).
This session, the user had me do the next step *by hand*, repeatedly, via browser
automation: open the real listing page, find the contact form, fill name/email/
address/household fields from the application profile, leave the message field with the
generated letter, and leave the submit button untouched for the user to review and
click themselves.

This feature formalizes that into a button in the Fredy UI.

### Reference implementation to adapt

`crawler/apply.py` in wohnungssuche (Playwright/patchright, Immowelt-only) is the
model to translate, not copy — it's Python/Playwright, Fredy is Node/Puppeteer. Key
logic worth preserving:

- `find_form()` — locate the contact form on the exposé page (some portals have it
  inline, some behind a "Nachricht schreiben" button click first)
- `fill_form()` / `fill_text()` / `choose()` — field-by-field filling with graceful
  degradation (log a warning and leave it for the user rather than crashing when a
  field isn't found)
- The **pause-and-confirm** flow: nothing is ever auto-submitted. The human clicks the
  real "Senden" button, then confirms back to the tool, which only then records the
  application.
- `applied.json` tracking → in Fredy this is already the listing `status` column and
  `POST /api/listings/:id/status {status:'applied'}` (used directly this session,
  confirmed working).

### Where it hooks into Fredy

- **Browser automation**: reuse `lib/services/extractor/puppeteerExtractor.js` and
  `lib/services/extractor/botPrevention.js` rather than adding Playwright as a new
  dependency — Fredy already ships a Puppeteer-based extractor and a CloakBrowser
  stealth Chromium binary (see `lib/services/ensureValidBinary.js`). The apply flow
  needs a **headful/visible** browser window (the user must see and click the real
  form), which is a different launch mode than the existing headless scraping use —
  check how `botPrevention.js`'s `browserActivityProbe` pattern launches browsers for
  DataDome-protected portals (Immowelt, SeLoger) for the closest existing precedent.
- **Field data**: reuse `lib/services/application/applicationService.js`,
  `contact.js`, `placeholders.js`, `renderTemplate.js` — this is the existing
  profile/template system (Settings → Application) that already produces the letter
  text and holds name/address/household/income. Do not invent a second profile store
  like wohnungssuche's `profile.toml`.
- **Per-provider form maps**: each portal's contact form has different field names
  (ImmoScout24's are `Vorname`, `Nachname`, `E-Mail`, `Straße`, `Hausnummer`,
  `Postleitzahl`, `Ort`, plus sometimes `Einzugstermin`/`Haushaltsgröße`/
  `Haustiere`/`Beschäftigungsart`/`Monatliches netto Haushaltseinkommen` dropdowns —
  confirmed empirically this session by filling ~19 real ImmoScout24 forms by hand).
  This needs a small per-provider module (new dir, e.g.
  `lib/services/application/formMaps/immoscout.js`) analogous to `lib/provider/*.js`'s
  plugin pattern, not a single generic selector set — portals disagree on field names.
- **Status/confirm UI**: new button on the listing detail page next to "Copy
  application letter". After the browser window opens and the user reports back (a
  "Mark as sent" button in Fredy's own UI, not a terminal prompt — this is a desktop
  app with a UI, use it), call the existing status endpoint.
- **New API route**: something like `POST /api/listings/:id/apply` to launch the
  browser + fill flow, separate from the existing `status` endpoint which just flips a
  DB column.

### Known gotchas from this session's manual runs (apply directly, don't rediscover)

- **Suchen+ paywalled listings**: ImmoScout24 blocks contacting some listings behind a
  paid "Suchen+" subscription — detect this (URL redirects to
  `/warenkorb/mieterplus/...`) and surface it in the UI as "can't apply, requires
  Suchen+" rather than silently failing.
- **WBS badge isn't in the blacklist-filterable text**: some listings require a
  Wohnberechtigungsschein but it's a structured badge/amenity, not blacklist-matchable
  title/description text. Not in scope for this feature, but worth a separate ticket —
  Fredy's blacklist missed these twice during manual review this session.
- **ImmoScout24 remembers previously-entered contact-form field values** in its own
  client-side state/localStorage across different listings in the same browser
  session/profile — re-filling Vorname/Nachname on a second listing in the same
  browser profile can append/duplicate text rather than overwrite. If reusing a
  persistent browser profile (recommended, mirrors wohnungssuche's `browser-profile/`
  dir, so cookies/consent survive restarts), select-all before typing into any field
  that might carry a stale value, not just type-and-append.
- **Cookie consent banner**: decline non-essential cookies before interacting with the
  form (see wohnungssuche's `decline_cookies()` for the two-click Usercentrics pattern
  — "Einstellungen oder ablehnen" then "Alles ablehnen").

---

## Feature 2: Traffic-aware car travel time

### What it does

Fredy's existing car/bike/walk travel time (`lib/services/transit/travelTimeService.js`,
`transitousClient.js`) explicitly does **not** model traffic — confirmed in the source's
own comment: "MOTIS does not model traffic, so the trip is the same all week." This adds
an optional, traffic-aware alternative for car mode specifically, using Google's Routes
API with a specific arrive-by time on the next weekday (matches commute planning, not
an abstract average).

### Reference implementation to adapt

`crawler/commute.py` in wohnungssuche is a clean, ~100-line reference:

- `departure_time(arrive_by, max_minutes)` — computes "next weekday, arrive_by minus
  max_minutes" as the departure timestamp
- `compute_route(origin, destination, depart, api_key, traffic_model)` — single POST to
  `https://routes.googleapis.com/directions/v2:computeRoutes` with
  `routingPreference: TRAFFIC_AWARE_OPTIMAL`, `departureTime`, `trafficModel`
  (`BEST_GUESS` or `PESSIMISTIC`), returns `(minutes, km)`
- Caches per `origin -> destination [traffic_model]` key, one request per unique
  address pair — same caching shape as Fredy's existing `transitCache.js`

### Where it hooks into Fredy

- New client module, e.g. `lib/services/transit/googleRoutesClient.js`, mirroring
  `transitousClient.js`'s shape (one function: origin+destination+departTime →
  `{minutes, km}`)
- Gate it behind a new setting: a `googleMapsApiKey` field under Settings → Travel
  time (likely near the existing address/mode config in
  `ui/src/` travel-time settings page — find via `grep -rl "travelTimeMaxMinutes" ui/src`)
- In `travelTimeService.js`, when computing `car` mode **and** the key is set, call the
  new Google client instead of (or in addition to, as a more-accurate overlay on) the
  existing OSRM-via-MOTIS street routing. When no key is set, fall back to current
  behavior unchanged — this must be fully optional, zero-config installs should see no
  behavior change.
- Needs an arrive-by time + weekday preference — either hardcode a sensible default
  (08:00 next weekday, matching wohnungssuche) or add it as a setting alongside the API
  key. Ask the user which before implementing — wohnungssuche hardcodes one destination
  address (`[commute] destination` in its `config.toml`); Fredy already supports
  multiple named addresses per user, so this should apply per-address, only to addresses
  where the user picked car mode.
- Cache keyed the same way as `transitCache.js` (per origin+destination+traffic_model),
  so this is one Google API call per unique listing-address pair, not per request.

### Cost note (carry over to user before enabling)

Google Routes API traffic-aware requests have a free monthly tier; wohnungssuche's
README notes normal usage (~dozens of new listings/day) stays well inside it, but it's
not literally free — flag this in the Fredy settings UI copy near the API key field, same
as wohnungssuche's README does.

---

## Rejected / already covered (do not re-propose these)

| wohnungssuche feature | Why it's out of scope |
|---|---|
| Immowelt scraping | Fredy already has `lib/provider/immowelt.js` |
| Rent/size/rooms/zip/word filters | Fredy already has job price/size/rooms filters + blacklist |
| `seen.json` dedup across runs | Fredy is a persistent DB app; inherent |
| Daily HTML/MD report (`report_html.py`) | Fredy's own UI + Telegram notifications replace this |
| `profile.toml` personal data file | Fredy's Settings → Application (DB-backed) is already better — don't add a second, file-based profile store |
| Scheduled daily cron / Task Scheduler | Fredy runs continuously as a service; not applicable |
| DataDome bot-detection workaround notes | Fredy already has provider-level `browserActivityProbe` for DataDome-protected portals |

---

## Suggested implementation order

1. Feature 2 (traffic-aware car time) first — smaller, self-contained, no new UI
   interaction model, lower risk.
2. Feature 1 (apply-automation) second — bigger, needs a new browser-launch mode, new
   API route, new per-provider form maps, and new UI. Start with ImmoScout24 only,
   confirm it works end-to-end on a handful of real listings before adding Immowelt.

## Before starting either

- Re-read `AGENTS.md` in this repo (architecture, conventions, "You do not commit... or
  create a new branch unless I told you so")
- Confirm with the user: arrive-by time/weekday default for feature 2, and whether
  Immowelt is in scope for feature 1's first cut
- Both features need tests per `AGENTS.md`'s "New features must be tested" — feature 2
  can use `TEST_MODE=offline` fixtures (mock the Google Routes response); feature 1's
  browser-automation path is harder to test offline and may need a narrower unit-test
  scope (e.g. just the form-field-mapping logic, not a real browser launch)
