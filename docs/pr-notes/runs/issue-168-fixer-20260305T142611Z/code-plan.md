# Code Role Plan (Fallback)

Implementation steps:
1. Add failing unit test in `tests/unit/team-management-access-wiring.test.js` asserting missing-team handling contract in `edit-team.html`.
2. Update `edit-team.html` `init()` to handle null team result:
   - alert with clear message
   - redirect to dashboard
   - early return
3. Run targeted test file via Vitest.
4. Run broader related test file(s) if needed for confidence.
5. Commit test + fix referencing issue #168.

Out-of-scope:
- Refactoring edit/create mode architecture.
- Changing db behavior for inactive inclusion.
