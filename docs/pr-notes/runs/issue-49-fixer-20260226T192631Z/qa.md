# QA Role Notes (Fallback)

Test strategy:
1. Unit test for admin invite acceptance helper path:
   - Valid admin invite -> updates profile and marks code as used.
   - Assert call order: validation before mutation.
   - Assert code usage marker invoked exactly once with expected `codeId` and `userId`.
2. Regression guard:
   - Parent invite path not changed; smoke run existing unit suite.

Manual verification checklist:
- Invite admin user A, accept invite, observe success.
- Retry same code as user B via manual entry.
- Confirm UI shows rejection (`Code already used`) and no new coach/admin grant.

Pass/fail gate:
- New unit test passes and existing unit tests pass.
