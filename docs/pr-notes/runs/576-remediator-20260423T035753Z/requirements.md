# Requirements role notes

## Acceptance Criteria
- After creating a new team, the app must enter edit mode for that specific team on the next screen.
- `init()` must run with the new `teamId` so the page loads existing team data, initializes the Team ID panel, and updates management links/banner state.
- A second click on Save after creation must update the created team, not create a duplicate team.
- Existing edit links that already use `?teamId=` must keep working.

## User-visible failure mode
- Current flow redirects to `edit-team.html#teamId=...` after `createTeam()`.
- Fragment-only navigation does not reload the document, so module-level `initialTeamId` stays `null`.
- The page remains in create mode, Team ID stays hidden, and another Save creates another team.

## Minimal requirement for fix
- Force a full navigation after creating the team so the page reinitializes with the new `teamId`.
- Keep the change scoped to the post-create redirect only.

## Edge cases to preserve
- Existing direct links with query or hash params should continue to parse because `getUrlParams()` supports both.
- `created=1` indicator should remain available after redirect.
- No change to update flow for existing teams.
