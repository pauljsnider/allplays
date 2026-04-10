Decision: align player-page UI authorization with the existing shared team access model instead of maintaining a second, looser rule in the page script.

Why:
- `js/team-access.js` already defines the canonical full-access rule used elsewhere.
- Reusing that helper reduces authorization drift and keeps UI behavior consistent with Firestore rules.

Current state:
- `player.html` computes `isCoachForTeam` from `currentUser.coachOf` and treats it as edit authorization.

Proposed state:
- Track the loaded team in page state.
- Call `hasFullTeamAccess(currentUser, currentTeam)` inside `updateEditButton()`.
- Combine that result with the existing linked-parent checks only.

Blast radius:
- Static page script only.
- No data model changes, no rule changes, no API changes.
