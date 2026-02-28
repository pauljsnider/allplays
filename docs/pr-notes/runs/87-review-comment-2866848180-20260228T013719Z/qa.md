# QA Role Notes

## Regression Focus
- RSVP summary counts remain correct for going/maybe/not going/not responded.
- Hydration still tolerates per-event read failures.
- Permission-denied user profile lookup still resolves as empty fallback.

## Verification Scope
- Static parse check of `js/db.js`.
- Diff review confirms only hydration cache and resolver wiring changed.

## Manual Checks Suggested
- Load calendar with recurring events for one team and confirm summaries render.
- Confirm no user-visible regression in RSVP chips on `calendar.html` and `parent-dashboard.html`.
