# QA Role Summary

## Regression Guardrails
- Verify access profile merge remains idempotent.
- Verify access code usage update still occurs only when `codeId` exists.
- Verify call order to prevent reintroduction of permission-denied sequence.

## Test Scope
- Unit tests in `tests/unit/admin-invite.test.js`.

## Added/Updated Assertions
1. `updateUserProfile` receives merged `coachOf` and `roles` values.
2. `updateUserProfile` invocation occurs before `addTeamAdminEmail`.
3. Existing checks for team-not-found and no-code behavior remain green.

## Residual Risk
No end-to-end emulator coverage in this change; runtime Firestore rule interplay remains validated indirectly via rule logic and unit ordering assertions.
