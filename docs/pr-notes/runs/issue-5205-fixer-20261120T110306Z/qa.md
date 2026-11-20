# QA role

The requested `allplays-qa-expert` skill was unavailable, and the required read-only role session failed before execution because the runtime reported `published reply runtime missing for main`. This main-lane synthesis applies the requested senior QA and regression-guardrail perspective.

Add a focused real-handler regression in `functions/test/parent-invite-creation.test.cjs` that uses the legacy permanent key for both terminal states:

1. Create an invite and advance the injected clock beyond the seven-day TTL.
2. Create an invite and mark it inactive/revoked.
3. Retry each operation with the identical idempotency key.
4. Assert a fresh code is created, the old terminal access code remains historical, and both server-owned coordinates now point to the fresh code.
5. Reuse the same operation key with a different recipient and assert the handler still fails closed without creating a second code.

Retain the existing tests that prove active recipient reuse and completed-operation replay. Run only the focused Node test file because the change is isolated to the Firebase Functions creation core.
