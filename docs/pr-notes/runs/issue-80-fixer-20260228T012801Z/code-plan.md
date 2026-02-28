# Code Role Plan (fallback in-process synthesis)

## Minimal patch steps
1. Add a small pure helper module for combining RSVP hydration results into event list.
2. Add failing unit tests for hydration summary application and non-overwrite semantics.
3. Add `getRsvpSummary` API in `js/db.js` using existing RSVP summary math.
4. Update Calendar and Parent Dashboard init hydration to fetch `myRsvp` + `getRsvpSummary`.
5. Run targeted unit tests then run all unit tests.
