# Architecture role synthesis

## Root cause
Authorization logic is duplicated inline in `edit-team.html` and `edit-roster.html`; both omit `coachOf` while shared helper `hasFullTeamAccess` already includes it.

## Minimal safe design
- Export and reuse `hasFullTeamAccess(user, team)` from `js/team-access.js` in both pages.
- Replace inline access predicates with helper call.
- Keep redirect behavior unchanged to limit blast radius.

## Blast radius
- Files: `edit-team.html`, `edit-roster.html`, tests.
- No data model, Firestore rules, or backend changes.

## Tradeoffs
- Fastest and lowest-risk patch is helper reuse in place.
- Larger refactor (centralized auth gate module per page) deferred.
