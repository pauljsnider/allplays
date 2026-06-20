# App Performance Baseline & Verification

This is the capstone measurement doc for the ALL PLAYS app-performance push
(issues #2029, #2032, #2033, #2034, #2035, #2036, #2037, #2038, #2043). It
defines the metric set, the repeatable measurement procedure, and a before/after
table to fill in as each fix lands, so the effort is *verified* rather than
assumed.

> Status: **baseline template**. Capture the "Before" column from `master` prior
> to merging the perf fixes, then re-measure after each fix and update the table.

## Metric set

| Metric | What it measures | How to capture |
| --- | --- | --- |
| Cold-start TTI (Home) | App launch → Home schedule cards interactive | `first meaningful render` span (web + device), Lighthouse TTI for web |
| Warm resume time | Foreground after backgrounding → fresh data on screen | Manual stopwatch + `app startup` span on resume |
| Firestore reads / Home mount | Read/REST count on a Home cold mount | Dev read-count instrumentation (see below) |
| Firestore reads / Schedule mount | Read/REST count to render the schedule | Dev read-count instrumentation |
| Firestore reads / Messages mount | Read/REST count to render the inbox | Dev read-count instrumentation |
| Entry chunk size (gzip) | Bytes parsed/executed before first render | `npm run app:build` build log |
| RSVP tap latency | Tap "Going" → confirmed | `rsvp tap latency` span |
| Chat send latency | Tap send → message confirmed | `chat send latency` span |

## Instrumentation

The app records these spans through `recordUxTiming` /
`recordAppUxTiming`, which already forwards to the production telemetry pipeline
(`js/telemetry.js`, event `app_ux_timing`). Canonical span names live in
`apps/app/src/lib/uxTiming.ts` (`UX_TIMING`):

- `app startup` — emitted in `main.tsx` at initial React render.
- `first meaningful render` — `recordFirstMeaningfulRender(route)`, fired once
  per page load when Home/Schedule leave their loading state. Baseline is
  navigation start, so this is the true cold-start cost.
- `rsvp tap latency` — `startInteractionTimer(UX_TIMING.rsvpTap)` around the
  parent RSVP submit in `scheduleService.ts`.
- `chat send latency` — `startInteractionTimer(UX_TIMING.chatSend)` around
  `sendTeamChatMessage` in `chatService.ts`.

Each span logs `[ux] <label> {"durationMs":…}` to the console in dev and is
captured as an `app_ux_timing` telemetry event in production, so lab numbers and
production percentiles share the same names.

### Reading Firestore read counts in dev

Open the app with the network panel filtered to `firestore.googleapis.com`
(web) or watch the native REST logs (`nativeRestLogging`), then cold-load each
page and count distinct collection list/get requests. The hydration fan-out
issue (#2033) tracks the 3×20-event scenario (~180 reads) explicitly.

## Measurement procedure (repeatable)

1. **Web (throttled 4G, desktop Chrome):**
   - `npm run app:build && npm run app:preview`.
   - DevTools → Performance/Lighthouse with "Slow 4G" + 4× CPU throttle.
   - Record cold-start TTI, entry chunk gzip (from the build log), and the
     `app_ux_timing` console spans for first meaningful render / RSVP / chat.
2. **iPhone (physical or simulator):** `npm run mobile:run:ios`, launch from
   cold, capture the resume case by backgrounding 6+ minutes then reopening.
3. **Mid-range Android:** `npm run mobile:run:android`, same procedure.
4. Record each number in the table below; keep the device/profile in the notes.

## Baseline → After

Fill the "Before" column from `master` at the start of the push; update the
remaining columns as fixes land. Numbers are medians of 3 runs.

| Metric | Before | After #2029 (bundle) | After #2033/#2037 (Home) | Target |
| --- | --- | --- | --- | --- |
| Cold-start TTI Home — web 4G | _tbd_ | | | < 2.5s |
| Cold-start TTI Home — iPhone | _tbd_ | | | < 2.0s |
| Cold-start TTI Home — Android | _tbd_ | | | < 3.0s |
| Warm resume → fresh data | _tbd_ | | | < 1.5s |
| Reads / Home mount (3×20) | ~180 | | | ≤ 30 |
| Reads / Schedule mount | _tbd_ | | | windowed |
| Reads / Messages mount | _tbd_ | | | parallel |
| Entry chunk gzip | 399.7 KB | | | < 150 KB |
| RSVP tap latency | _tbd_ | | | < 600ms |
| Chat send latency | _tbd_ | | | < 800ms |

## Closing the loop

When the perf/UX fixes have landed, re-measure, fill the final column, and paste
the completed table into #2050 before closing it. The procedure above is the
contract: anyone should be able to reproduce these numbers from a clean checkout.
