# Code Role Synthesis

## Minimal patch plan
1. Update `markAccessCodeAsUsed` to transactionally read and set `used` fields; throw if already used.
2. Update `executeEmailPasswordSignup` standard flow to fail closed on code-claim error and cleanup created auth user.
3. Refactor `redeemParentInvite` to transactionally claim code at start; keep existing profile/player writes; add rollback of code claim on downstream failure.
4. Add/extend unit tests for failing-first behavior and atomic guardrails.
5. Run targeted Vitest files and then broader related tests.
