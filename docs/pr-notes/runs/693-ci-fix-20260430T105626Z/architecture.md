# Architecture Notes

## Acceptance Criteria
- `js/db.js` changes are paired with browser import cache-bust version changes so deployed static pages do not keep stale DB module code.
- Scope stays limited to import query parameters on pages already changed by this PR.

## Architecture Decisions
- No application behavior changes are required for the CI failure.
- Bump the `./js/db.js` import query version in `player.html` and `team.html`, the changed pages that consume the changed DB helper module.

## Risks And Rollback
- Risk is low: query-string-only static import change.
- Rollback is reverting the import version bump commit if needed.
