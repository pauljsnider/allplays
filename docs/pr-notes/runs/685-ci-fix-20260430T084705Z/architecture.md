# Architecture Notes

Subagents were unavailable in this environment, so this role analysis was completed inline.

## Root cause
`team.html` now imports `./js/db.js?v=76`, but `tests/smoke/team-schedule-calendar.spec.js` only mocks `**/js/db.js?v=76`. The smoke test therefore falls through to the real `db.js` module instead of the deterministic stub, leaving the team schedule page in its loading state under preview smoke.

## Minimal fix
Update the smoke module route to match the active cache-busted import. Because the page import also includes `getLocalAttractionSponsors`, keep the DB stub export surface aligned so the module can load completely in isolation.

## Blast radius
Test-only change scoped to the team schedule calendar smoke harness. No production runtime behavior changes.
