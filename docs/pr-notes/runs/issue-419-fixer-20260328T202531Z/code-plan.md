Objective: make the smallest safe patch that closes issue #419.

Plan:
1. Add `tests/unit/accept-invite-page.test.js` to execute the real inline module with mocked imports and DOM state.
2. Write one test for authenticated parent invite success plus duplicate-auth idempotency.
3. Write one test for logged-out manual code redirect, then authenticated continuation with single redemption.
4. Patch `accept-invite.html` with a page-local guard that suppresses duplicate processing for the same `userId` and invite code while preserving retry on failure.
5. Run targeted Vitest commands and commit the test plus runtime fix together.
