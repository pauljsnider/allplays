# QA Role Summary

## Regression Risk
High likelihood of UX regressions when client and Firestore permissions diverge.

## Test Strategy
- Target helper-level unit tests (`tests/unit/team-access.test.js`) for access decisions.
- Keep existing owner/admin/platform-admin/parent coverage.
- Replace coach-full-access assertions with deny assertions for coach-only users.

## Verification Focus
- Impacted workflow: entering team management pages with coach-only assignment.
- Expected result after fix: blocked before edit attempt; no save-time auth failure loop.
