# db.js Lazy Imports Requirements

## Introduction

`js/db.js` is a 10,668-line module that centralizes nearly all Firestore/Storage/Functions access for the legacy site. It has 44 static top-level `import` statements, many pulling in large, feature-specific modules (registration review, volunteer screening, bracket management, team rollover, certificates, officiating, admin search, team media, etc.).

The legacy site ships no bundler — pages load raw ES modules over HTTP with cache-busting query params. Per the ES module spec, a browser must fetch and parse a module's *entire* static import graph before any of that module's exported code can run. Because almost every legacy page imports at least one function from `db.js`, every page pays for downloading and parsing all 44 of `db.js`'s dependencies, even though a given page (e.g. `live-game.html`) only calls a handful of `db.js`'s ~150 exported functions.

Measured live on production (2026-08-23):
- `live-game.html?replay=true` loads 89 separate JS files, taking ~2000ms for the script waterfall to clear before the page is meaningfully interactive.
- `team.html` loads 82 JS files (~1000ms, partially cache-warmed from a prior page).
- Individual module fetches ranged 200ms–1250ms each.

This is reported by users as "everything feels very delayed at first" and is not confined to one page — it affects any legacy page that touches `db.js`.

The fix: convert `db.js`'s narrowly-used imports (modules consumed by only one or a few of `db.js`'s exported functions, none of them on the hot path shared by most pages) from static `import` to dynamic `import()` calls placed inside the specific function bodies that use them. Every consuming function is already `async`, and browsers cache a module URL after its first dynamic `import()`, so this only defers a module's fetch from "page load" to "first time a caller actually invokes the function that needs it" — for pages that never call that function, the module is never fetched at all. 28 of the 44 imports qualify; one candidate (`team-email-attachments.js`) was ruled out because `db.js` re-exports it wholesale (see R1.4, R2.4) and a re-export must resolve statically.

## Non-Goals

- This is not a rewrite of `db.js`'s logic, exports, or public API. No exported function's signature, return value, or behavior changes.
- This does not introduce a bundler or build step for the legacy site.
- This does not touch the ~14 imports used by hot-path functions called on nearly every page (e.g. `getGame`, `subscribeGame`, `getPlayers`) — those stay static since deferring them buys little and adds an awkward `await import()` to already-critical code.
- This does not address the separate, already-identified bug in `js/live-game-video.js` where the live YouTube channel embeds during replay mode (tracked separately).

## User Stories

### US-1: Fan loads a live game or replay page quickly
As a fan opening a live game or replay link, I want the page to become usable quickly, so that I'm not staring at placeholder "Home Team / Away Team" content while dozens of unrelated admin modules download in the background.

### US-2: Coach/parent loads any legacy page quickly
As a coach or parent navigating the legacy site (team page, schedule, roster, etc.), I want normal navigation to feel responsive, so that the app doesn't feel broken or slow on first load or on a slower mobile connection.

### US-3: Developer adds a new db.js function safely
As a developer adding a new narrowly-scoped function to `db.js`, I want a clear, established pattern (dynamic import inside the function body) to follow, so that new niche features don't silently regress page-load performance for pages that don't use them.

### US-4: Reviewer verifies no behavior change
As a code reviewer, I want confidence that converting an import from static to dynamic does not change what the function does, only when its dependency is fetched, so that this change can be reviewed as a mechanical, low-behavioral-risk performance fix rather than a logic change.

## Requirements (EARS format)

### R1: Scope of conversion
1.1. WHEN a module imported by `db.js` is used by only a bounded, identifiable set of `db.js`'s exported functions (not by hot-path functions such as `getGame`, `subscribeGame`, `getPlayers`, `getConfigs`, `getMyRsvp`), THE SYSTEM SHALL convert that module's static import into a dynamic `import()` call placed inside each consuming function's body.

1.2. WHEN a module is used by a hot-path function that most pages call during initial load, THE SYSTEM SHALL leave that module as a static top-level import in `db.js`.

1.3. THE SYSTEM SHALL apply this conversion to the following modules (confirmed single- or few-function usage, no hot-path overlap, not re-exported by `db.js`): `drill-upload-paths.js`, `fallback-media-paths.js`, `profile-photo-paths.js` (validateProfilePhotoFile/buildPlayerProfilePhotoPath/buildTeamProfilePhotoPath/buildUserProfilePhotoPath only — not shared with hot-path use), `access-code-utils.js`, `parent-membership-utils.js`, `rsvp-player-fallback.js`, `availability-preferences.js`, `admin-user-official-links.js`, `admin-search.js`, `availability-cutoff-date.js`, `family-share-utils.js`, `notification-preferences.js`, `local-attractions.js`, `join-code.js`, `roster-profile-fields.js`, `rsvp-family-write.js`, `athlete-profile-utils.js`, `friend-invite.js`, `certificates/persistence.js`, `bracket-management.js`, `team-rollover.js`, `player-tracking-summary.js`, `registration-review.js`, `volunteer-screening-access.js`, `tournament-standings.js`, `team-media-utils.js`, `officiating-utils.js`, `officiating-notifications.js`.

1.4. THE SYSTEM SHALL leave the following as static imports: `firebase.js` (core Firestore/Auth/Storage/Functions SDK bindings), `firebase-images.js`, `vendor/firebase-storage.js`, `secure-upload-token.js`, `rsvp-doc-ids.js`, `rsvp-summary.js`, `game-day-rsvp-breakdown.js`, `team-chat-media.js`, `team-chat-conversations.js`, `shared-schedule-sync.js`, `shared-games.js`, `team-visibility.js`, `stat-leaderboards.js`, and `team-email-attachments.js` (confirmed re-exported wholesale via `export {...} from './team-email-attachments.js'` at db.js:249-257 — other files may statically import these names from `db.js` itself, which requires the source to resolve statically; see R2.4).

1.5. THE SYSTEM SHALL remove the unused `getApp` import from `vendor/firebase-app.js` (zero usages confirmed) as a zero-risk drive-by cleanup.

### R2: Behavioral equivalence
2.1. WHEN a converted function is called, THE SYSTEM SHALL produce identical return values, side effects, and error behavior to the pre-conversion implementation.

2.2. WHEN a module is imported dynamically by more than one function, THE SYSTEM SHALL rely on the browser's module cache (not custom caching logic) to avoid redundant network fetches on repeat calls.

2.3. WHERE a single function uses multiple named exports from the same module, THE SYSTEM SHALL destructure them from one `await import()` call, not one per name.

2.4. IF a candidate module is also re-exported from `db.js` via `export {...} from '...'` (confirmed true today only for `team-email-attachments.js`, at db.js:249-257), THEN THE SYSTEM SHALL leave that import static, since dynamic import cannot satisfy a static re-export. THE SYSTEM SHALL re-check this condition before converting any module not already ruled out by R1.3/R1.4, in case the source has changed since this spec was written.

### R3: Verification
3.1. WHEN the conversion is complete, THE SYSTEM SHALL pass the full existing unit test suite (`npm test`) without modification to test expectations.

3.2. WHEN the conversion is complete, THE SYSTEM SHALL pass the existing smoke test suite (`npm run test:smoke`) without modification to test expectations.

3.3. WHEN `live-game.html?replay=true` is loaded after the change, THE SYSTEM SHALL fetch measurably fewer JS files than the pre-change baseline of 89, excluding modules genuinely required by that page's call path.

3.4. WHEN a niche feature (e.g. registration review, bracket publishing, team rollover) is exercised end-to-end after the change, THE SYSTEM SHALL behave identically to before the change, confirmed via existing coverage or a manual smoke check where automated coverage is thin.

## Success Criteria

- `live-game.html` and `team.html` script-waterfall file counts drop substantially (target: roughly halved or better) without any loss of functionality.
- No `db.js` exported function's behavior, signature, or error handling changes.
- All existing automated tests remain green.
- The pattern used here (dynamic import inside narrowly-used exported functions) is legible enough that a future PR adding a new niche `db.js` function can follow it without re-deriving the rationale.

## Open Questions

- Should this same treatment be applied to other large shared modules (e.g. `auth.js`, `utils.js`) in a follow-up, or is `db.js` the dominant contributor to the waterfall? (Out of scope for this spec; worth a follow-up measurement once this lands.)

---

## Addendum: Tailwind Play CDN removal (related but separate finding)

Found during the same production-slowness investigation as the `db.js` waterfall above. Tracked in this spec dir at the user's request; it is a **separate root cause and a separate implementation effort** from the `db.js` import conversion — do not conflate the two when scoping tasks/PRs.

### Problem

76 of the legacy site's HTML pages load Tailwind CSS via the Play CDN script:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

This is a runtime JIT compiler: on every page load, it scans the rendered DOM in the browser and generates CSS on the fly. The browser console logs Tailwind's own warning on every load: *"cdn.tailwindcss.com should not be used in production. To use Tailwind CSS in production, install it as a PostCSS plugin or use the Tailwind CLI."*

The script is also explicitly allowlisted in both CSP policies in `firebase.json` (`script-src ... https://cdn.tailwindcss.com`, lines 46 and 71), so removing it as a dependency also means tightening the CSP.

### Why it matters

Runtime JIT compilation blocks style application until the scan+generate pass completes, adds a non-trivial JS payload to every page, and produces unminified, non-cached CSS on every load (as opposed to a build-time-generated stylesheet the browser can cache like any other static asset). It compounds the `db.js` script-waterfall problem above rather than causing it — the two should be measured and fixed independently, but both contribute to "everything feels delayed at first."

### Proposed direction (not yet a full requirements/design pass)

1. Add a real Tailwind build step for the legacy site (Tailwind CLI or PostCSS), generating a static, versioned `tailwind.css` file the same way `js/*.js` files use cache-busting `?v=` query params today.
2. Replace the `<script src="https://cdn.tailwindcss.com">` tag on all 76 pages with a `<link rel="stylesheet" href="tailwind.css?v=N">`.
3. Update both CSP policies in `firebase.json` to drop `https://cdn.tailwindcss.com` from `script-src` once no page depends on it, and ensure the generated stylesheet is compatible with the existing `style-src 'self' 'unsafe-inline'` policy.
4. Add the build step to whatever process currently bumps the legacy site's `?v=` cache-busting numbers, so it isn't a manual, easy-to-forget step.

### Why this needs its own requirements/design/tasks pass before implementation

Unlike the `db.js` conversion (mechanical, behavior-preserving, no build tooling involved), this introduces a **build step where none exists today** for the legacy site. That's a bigger architectural decision — it touches deploy tooling, CI, and how every legacy page ships CSS — and deserves its own EARS requirements and design doc rather than being implemented off this paragraph. This addendum exists to capture the finding and rough direction; a follow-up spec (or an expansion of this one into a dedicated `spec/tailwind-cdn-removal/` directory) should work out the details before any code changes land.
