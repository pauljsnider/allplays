# Code Role Plan

## Files to update
- `js/db.js`
- `js/admin.js`
- `admin.html`
- `firestore.rules`
- `tests/unit/team-visibility.test.js` (new)

## Minimal patch outline
1. Add reusable `isTeamActive` predicate and db helper options (`includeInactive=false`).
2. Convert `deleteTeam` to update-only soft delete fields (`active`, `deactivatedAt`, `deactivatedBy`, `updatedAt`).
3. Ensure `createTeam` defaults active metadata.
4. Filter parent dashboard future flows by active team.
5. Exclude inactive teams from live/upcoming discovery; keep replays inclusive.
6. Admin page: active-only default with explicit include-inactive toggle.
7. Firestore rules: disallow client team document delete.
8. Add Vitest coverage for active filtering and replay policy helper behavior.
