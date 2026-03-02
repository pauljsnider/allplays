# QA Role - Issue #131

## Regression Strategy
Add static wiring regression coverage to ensure `edit-config.html` uses shared team access helper.

## Test Plan
1. Update `tests/unit/team-management-access-wiring.test.js` with a new case for `edit-config.html` expecting:
   - import from `./js/team-access.js`
   - usage of `hasFullTeamAccess(`
2. Run targeted test file to validate failure before fix.
3. Apply code fix.
4. Re-run targeted test file to confirm pass.
5. Run `tests/unit/team-access.test.js` as guardrail for full-access semantics.

## Residual Risk
- Static wiring tests validate integration pattern, not browser runtime.
- Risk considered low because page imports are already module-based and helper is stable.
