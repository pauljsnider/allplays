# Architecture Role (Fallback Synthesis)

## Current state
- Centralized helper `js/team-access.js` is imported by management pages.
- `hasFullTeamAccess` currently grants full access only for owner/adminEmail/platform-admin.
- Delegated coach (`coachOf`) is not part of centralized full-access decision.

## Proposed state
- Extend `hasFullTeamAccess` to include delegated coach check:
  - `Array.isArray(user.coachOf) && user.coachOf.includes(team.id)`
- Keep call sites unchanged; pages already use helper and pass `{ ...team, id: team.id || teamId }`.

## Blast radius
- Low and controlled: single helper function used by access-gated pages.
- Expected impact: delegated coaches gain full access parity where helper is consumed.
- No Firestore rules or backend write paths changed.

## Controls
- Access still constrained to explicit ownership/admin/platform-admin/coach assignment.
- No widening to unrelated users.
