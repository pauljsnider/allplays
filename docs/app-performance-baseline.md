# App Performance Baseline & Verification

This is the capstone measurement doc for the ALL PLAYS app-performance push
(issues #2029, #2032, #2033, #2034, #2035, #2036, #2037, #2038, #2043) and the
repeatable baseline workflow for issue #2896. It defines the metric set, the
device/network profiles, the repeatable measurement procedure, and baseline /
after-fix tables to fill in as each fix lands, so the effort is *verified*
rather than assumed.

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
| RSVP tap latency | Open a Schedule event and tap "Going" → RSVP confirmed | `app_ux_timing` telemetry event filtered to label `rsvp tap latency` |
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
  parent RSVP submit in `scheduleService.ts`. RSVP timing validation uses the
  lab action "open a Schedule event and tap Going" and the `app_ux_timing`
  telemetry event filtered to label `rsvp tap latency`.
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

## Test profiles

Run the same metric set on each profile. Record exact browser/device versions,
network conditions, build SHA, account/team fixture, and any seeded data notes
beside the result.

| Profile | Environment | Network and CPU | Capture tools |
| --- | --- | --- | --- |
| Desktop web | Chrome stable on a developer workstation | Online, no throttling | DevTools Performance, console `app_ux_timing`, build log |
| Throttled 4G web | Chrome stable on a developer workstation | DevTools "Slow 4G" plus 4x CPU throttle | DevTools Performance/Lighthouse, console `app_ux_timing`, build log |
| Mid-range Android | Physical mid-range Android or representative emulator | Normal Wi-Fi unless testing a named carrier profile | Native REST logs, console telemetry, manual stopwatch for resume |
| iPhone | Physical iPhone or current simulator | Normal Wi-Fi unless testing a named carrier profile | Xcode console, telemetry, manual stopwatch for resume |

## Measurement procedure (repeatable)

1. **Prepare the app once per SHA:**
   - `npm run app:build && npm run app:preview`.
   - Use the same test account, organization/team, and seeded Home/Schedule/
     Messages data across baseline and after-fix runs.
   - Record the entry chunk gzip size from the build output or bundle-size check.
2. **Desktop web:**
   - Open the preview URL in Chrome with no throttling.
   - Capture cold-start Home TTI, warm resume, Firestore reads for Home /
     Schedule / Messages, RSVP tap latency, and chat send latency.
3. **Throttled 4G web:**
   - Repeat the desktop web steps with DevTools "Slow 4G" plus 4x CPU throttle.
   - Use the same Chrome profile state for the baseline and after-fix runs.
4. **Mid-range Android:**
   - `npm run mobile:run:android`, launch from cold, then capture the resume case
     by backgrounding 6+ minutes and reopening.
   - Capture Firestore reads from native REST logs and latency spans from console
     telemetry.
5. **iPhone:**
   - `npm run mobile:run:ios`, launch from cold, then capture the resume case by
     backgrounding 6+ minutes and reopening.
   - Capture Firestore reads from native REST logs and latency spans from Xcode
     console telemetry.
6. Record each number in the templates below. Numbers are medians of 3 runs, and
   each run should start from a clean app launch unless the row explicitly says
   warm resume.

## Baseline template

Fill this table from `master` at the start of the push without changing the
measurement method.

| Profile | Cold-start TTI Home | Warm resume | Reads / Home mount | Reads / Schedule mount | Reads / Messages mount | Entry chunk gzip | RSVP tap latency | Chat send latency | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop web | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |
| Throttled 4G web | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |
| Mid-range Android | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |
| iPhone | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |

## After-fix template

Copy this table for each performance PR or milestone and fill it with the same
profiles, account/team fixture, and capture steps used for the baseline.

| Profile | Fix / SHA | Cold-start TTI Home | Warm resume | Reads / Home mount | Reads / Schedule mount | Reads / Messages mount | Entry chunk gzip | RSVP tap latency | Chat send latency | Delta / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop web | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |
| Throttled 4G web | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |
| Mid-range Android | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |
| iPhone | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | |

## Baseline → After

Keep this summary table current as fixes land. Numbers are medians of 3 runs.

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
