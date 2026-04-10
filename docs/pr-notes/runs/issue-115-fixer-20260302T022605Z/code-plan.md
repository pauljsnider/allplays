# Code Role Plan (Fallback Synthesis)

## Minimal patch plan
1. Modify `tests/unit/team-access.test.js`:
   - Replace old expectation that coach is denied.
   - Add expectation that delegated coach receives full access via `getTeamAccessInfo`.
2. Modify `js/team-access.js`:
   - Add `isCoach` check based on `user.coachOf` and `team.id`.
   - Include `isCoach` in full-access return condition.
3. Run targeted tests:
   - `tests/unit/team-access.test.js`
   - `tests/unit/team-management-access-wiring.test.js`
4. Stage and commit with issue reference.
