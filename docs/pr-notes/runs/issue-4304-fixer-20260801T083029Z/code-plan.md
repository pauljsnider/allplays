# Code Plan

1. Add a server-only `family-invite-identity-core.cjs` resolver with token-first, Admin Auth fallback behavior and no request/profile inputs.
2. Add helper regression tests before implementation.
3. Resolve the authoritative email in each family invite callable before its transaction and compare it to the latest invite email before any transaction mutation.
4. Remove `authEmail` from all three `js/db.js` callable payloads while keeping signatures compatible.
5. Update parent, household, and co-parent source contracts to prevent request fallback and verify pre-write ordering.
6. Bump the cache-critical `db.js` import cohort and any transitive `auth.js` cohort required by the guard.
7. Run focused tests, cache-bust validation, inspect the exact diff, and commit once with issue #4304 in the message.

Rollback is a single-commit revert. There is no schema migration or data rewrite.
