# Architecture Notes

## Acceptance Criteria
- Admin invite signup and invite acceptance pages load the cache-busted auth and DB modules expected by the PR #987 unit tests.
- Changes remain limited to static ES module query parameters and do not alter runtime behavior.

## Architecture Decisions
- Keep the existing static-site cache-busting pattern using explicit `?v=` query parameters.
- Bump only stale imports on the affected admin invite path and listed auth consumers.

## Risks And Rollback
- Risk is low: browser import URLs change, implementation code does not.
- Rollback is reverting the cache-bust import edits if an unexpected production cache issue appears.
