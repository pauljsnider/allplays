# Code Role Plan - Issue #131

## Patch Steps
1. Add failing test in `tests/unit/team-management-access-wiring.test.js` for `edit-config.html` helper wiring.
2. Update `edit-config.html`:
   - import `hasFullTeamAccess` from `./js/team-access.js`
   - simplify `hasAccess(team, user)` to return `hasFullTeamAccess(user, team)`
3. Run targeted Vitest suites:
   - `tests/unit/team-management-access-wiring.test.js`
   - `tests/unit/team-access.test.js`
4. Stage all changed files and commit with issue reference.

## Non-Goals
- No refactor of banner rendering or team access module.
- No changes to Firebase rules or backend checks.
