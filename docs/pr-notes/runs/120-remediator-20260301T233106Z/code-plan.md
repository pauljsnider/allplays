# Code Role Notes

Implementation plan:
1. Update `js/auth.js` parent-invite error handler to explicitly guard and delete the created Auth user instance before rethrowing.
2. Update unit test setup to assert cleanup against the created credential user object, not implicit auth state.
3. Run focused unit test file.
4. Commit only files related to these review threads plus required run notes.

Assumptions:
- Vitest is configured in this PR branch for `tests/unit/*`.
- Review feedback scope is parent-invite signup cleanup only.
