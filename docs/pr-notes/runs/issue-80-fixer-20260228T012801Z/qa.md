# QA Role (fallback in-process synthesis)

## Regression risks
- Non-recurring events with existing `rsvpSummary` should continue rendering correctly.
- Summary mapping must preserve response buckets (`going`, `maybe`, `notGoing`, `notResponded`, `total`).

## Test plan
- Unit test summary recomputation helper behavior for recurring-style occurrence IDs (indirectly via pure hydration helper).
- Unit test hydration merger applies fetched summary when event summary is null.
- Run targeted vitest file and full unit suite spot check.

## Manual checks
- Submit RSVP on recurring occurrence in Calendar, reload, confirm totals persist.
- Repeat in Parent Dashboard.
