# Code role notes

## Smallest viable fix
- Update `buildTeamEditUrl(teamId, created = false)` in `edit-team.html` to return a query-string URL instead of a hash URL.

## Exact code surface
- File: `edit-team.html`
- Function: `buildTeamEditUrl`
- No changes required in `getUrlParams()` because it already supports both search and hash params.

## Validation notes
- Inspect diff to confirm only the redirect URL format changed.
- Manual validation should confirm create -> edit reload behavior and preserve legacy hash parsing for existing links.
