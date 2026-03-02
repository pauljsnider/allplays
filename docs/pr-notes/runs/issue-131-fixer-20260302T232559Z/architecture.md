# Architecture Role - Issue #131

## Root Cause
Access logic diverged across pages:
- Shared module `js/team-access.js` defines full access as owner/adminEmail/platform admin.
- `edit-config.html` duplicated logic and omitted platform admin.

## Minimal Safe Design
- Import `hasFullTeamAccess` from `js/team-access.js` inside `edit-config.html`.
- Replace local duplicated `hasAccess` logic with a wrapper calling `hasFullTeamAccess(user, team)`.

## Risk Surface / Blast Radius
- Blast radius limited to `edit-config.html` page gating.
- No Firestore schema/rules changes.
- No API signature changes.

## Compatibility
- Aligns with existing patterns in `edit-team.html` and `edit-roster.html`.
- Preserves existing behavior for owner/team admin and denies unrelated users.
