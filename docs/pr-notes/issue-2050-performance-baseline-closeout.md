# Issue #2050: Performance Baseline Closeout

Draft PR anchor for #2050.

## Current Finding

The repository now has `docs/app-performance-baseline.md` and expanded
`uxTiming` coverage, but the capstone issue is not complete until the final
before/after measurements are captured and the `tbd` fields are replaced with
real numbers.

## Implementation Scope

- Capture the final metric table in `docs/app-performance-baseline.md`.
- Verify app-start to first meaningful render, RSVP tap latency, and chat-send
  latency are emitted through the app telemetry path.
- Record the measurement SHA, device/browser matrix, account/team fixture, and
  any network/CPU throttling used for each profile.
- Paste the final summary table into #2050 when the doc is complete.

## Acceptance

- `docs/app-performance-baseline.md` contains measured before/after values, not
  placeholders, for the profiles that can be reproduced.
- Any unavailable device measurement is explicitly marked with the reason and a
  follow-up owner.
- The `UX_TIMING` labels used by the app match the labels documented for the
  measurement table.

## Validation

- `npm run app:build`
- Manual desktop web baseline capture
- Manual throttled 4G capture
- Native iOS/Android capture where hardware or simulator access is available
