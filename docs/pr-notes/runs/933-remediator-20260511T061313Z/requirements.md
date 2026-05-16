# Requirements

- Address PR review feedback by removing officiating self-assignment eligibility dependence on `users/{uid}.playerTeamIds`, because the field is not populated anywhere in the app.
- Preserve current working access paths: team owner, team admin email, global admin, and confirmed parent team membership via `parentTeamIds`.
- Keep unauthorized users from adding themselves to officiating authorization arrays through direct Firestore writes.
- Update guard tests so they no longer encode the unsupported `playerTeamIds` policy.

## Acceptance Criteria
- `js/db.js` no longer grants claim eligibility from `userProfile.playerTeamIds`.
- `firestore.rules` no longer grants open slot claim updates from `playerTeamIds`.
- `officials.html` copy and UI gate match the supported eligible participant set.
- Unit guard for officiating slots passes.
