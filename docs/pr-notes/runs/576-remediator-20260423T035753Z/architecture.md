# Architecture role notes

## Current state
- `edit-team.html` reads `initialTeamId` once at module load from `getUrlParams()`.
- New team creation redirects with `window.location.href = buildTeamEditUrl(newTeamId, true)`.
- `buildTeamEditUrl()` currently returns `edit-team.html#teamId=...`.

## Root cause
- Changing only the fragment on the same document does not reload the page.
- Because the module is not re-executed, `initialTeamId` remains `null` and `init()` is not rerun for the newly created team.

## Recommended minimal design change
- Change `buildTeamEditUrl()` to return a query-string URL such as `edit-team.html?teamId=...&created=1`.
- Keep `getUrlParams()` unchanged so legacy hash-based links still parse.

## Alternatives rejected
- Add `hashchange` handling plus state rehydration: broader change, more moving parts.
- Mutate in-memory state after create without navigation: higher risk because init side effects would need to be replicated.

## Risks and rollback
- Risk is low because the page already uses query params elsewhere for team navigation.
- Rollback is a one-function revert if any unexpected routing issue appears.
