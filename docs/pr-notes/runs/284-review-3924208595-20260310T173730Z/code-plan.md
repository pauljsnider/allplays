# Code role

- Scope: minimal safe patch.
- Change made: update `tests/unit/team-management-access-wiring.test.js` to assert `getUserTeamsWithAccess(user.uid, user.email || profile?.email)`.
- No product code edit required because head commit `cd765dd` already contains the dashboard fix.
- Validation plan:
  - run focused vitest suite for `team-access` and `team-management-access-wiring`
  - inspect branch diff versus reviewed commit to confirm the dashboard change exists
- Rollback: revert the test-only commit if needed; product behavior remains in the prior branch commit.
