# Requirements Notes

## Acceptance criteria
- The roster rollover team picker must include teams where the current user has access through owner id or admin email.
- If Firebase Auth does not provide `currentUser.email`, the lookup must fall back to the Firestore profile email before calling `getUserTeamsWithAccess`.
- Roster preview state must always correspond to the currently selected source team.
- Stale preview successes, stale preview errors, and cleared-selection responses must not update the visible preview or status.
- Roster rollover remains preview-only. Saving a new team must not copy roster, family, staff, admin, or fan records.

## Edge cases
- Auth email present and profile email absent.
- Auth email absent and profile email present.
- Auth/profile lookup failure.
- Rapid source team changes where the first `getPlayers` call resolves after the later one.
- Source selection cleared while a preview request is in flight.
