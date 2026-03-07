Implementation plan:
1. Update `tests/unit/accept-invite-flow.test.js` so missing atomic admin redemption is a failing condition instead of exercising the legacy fallback.
2. Remove the non-atomic admin invite fallback from `js/accept-invite-flow.js`.
3. Run targeted Vitest coverage for invite/admin redemption.
4. Commit the scoped change referencing issue #191.
