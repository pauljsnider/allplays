# QA Role (Fallback Synthesis)

## Regression risks
- Accidentally granting access to non-coach users.
- Breaking parent-level access classification.

## Test strategy
- Update `tests/unit/team-access.test.js` to assert delegated coach has full access.
- Add access-info assertion for delegated coach to verify access level is `full`.
- Keep existing unrelated and parent tests to ensure no regressions.
- Run targeted Vitest suites for team access and page wiring.

## Manual sanity checks (post-merge)
1. Login as user with `coachOf` including team id; open `edit-team.html#teamId=<id>`.
2. Open `edit-roster.html#teamId=<id>` from banner.
3. Confirm no redirect to `dashboard.html` and no access-denied alert.
