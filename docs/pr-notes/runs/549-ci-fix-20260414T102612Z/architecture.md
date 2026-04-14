# Acceptance Criteria
- The edit-team admin access persistence unit suite loads the extracted edit-team module source without any raw ES module import statements remaining.
- The fix does not change edit-team runtime behavior in production.
- The failing CI check passes with the existing assertions unchanged.

# Architecture Decisions
- Fix the test harness, not the production page, because the regression is in the test extractor falling out of sync with a newly added import in `edit-team.html`.
- Stub `getDefaultStatConfigForSport` in test deps, matching the existing dependency-injection pattern already used for other imports.
- Keep scope limited to the failing test file.

# Risks And Rollback
- Risk is low because the production module is untouched.
- If this change caused unexpected test behavior, rollback is a single-file revert of `tests/unit/edit-team-admin-access-persistence.test.js`.
