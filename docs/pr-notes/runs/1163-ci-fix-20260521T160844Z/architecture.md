# Architecture Notes

## Acceptance Criteria
- `js/db.js` changed in the PR must have a matching cache-busted import version change so deployed browsers do not keep using the prior cached module URL.
- Keep the fix scoped to cache invalidation only.

## Architecture Decisions
- Bump an existing `db.js` query-string version in a browser entry point instead of changing runtime logic.
- Avoid touching Firebase rules, functions, or data model code for this CI-only regression.

## Risks And Rollback
- Risk is limited to forcing reload of the `db.js` module for the updated entry point.
- Rollback is the single cache-bust import version change if needed.
