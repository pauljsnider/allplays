# Patch Plan

1. Extend the existing OAuth store contract with durable code issue and atomic consume operations.
2. Add shared, bounded authorization-code state to the memory adapter.
3. Add hashed, encrypted, expiring authorization-code documents and conditional consume to the Firestore adapter.
4. Remove the broker-local code map, make approval async, and consume before validation.
5. Await approval in the HTTP route.
6. Add focused cross-instance, race, invalid-grant, persistence, and retention tests.
7. Document durable authorization-code controls.

# Code Changes Applied

No code was applied by the analysis role. The main fixer lane owns all edits.

# Validation Run

Planned focused validation: `npx vitest run tests/unit/chatgpt-mcp-oauth.test.js --reporter=verbose`.

# Residual Risks

- Firestore TTL is asynchronous, so the durable bound is time-based.
- A grant-issuance failure after consume requires the user to restart authorization.
- Type-specific authenticated metadata must preserve compatibility for existing access and refresh grants.
- The REST fake models conditional semantics but does not replace an emulator or deployed canary.

# Commit Message Draft

`Persist OAuth authorization codes across instances (#4159)`

# Synthesized Execution Plan

## Acceptance Criteria

Cross-instance exchange succeeds; concurrent consume has one winner; invalid binding fields and expiry return `invalid_grant`; credential binding remains encrypted and correct.

## Architecture Decisions

Reuse the existing OAuth store, use hashed code document IDs, authenticate all code metadata in encryption, consume with a Firestore `updateTime` precondition, and retain existing optional client/redirect request behavior.

## QA Plan

Write tests first for independent brokers, races, validation failures, persistence shape, and bounded memory behavior. Keep the focused OAuth suite as the local gate.

## Implementation Plan

Make the smallest changes in `oauthStore.js`, `oauth.js`, `server.js`, the focused unit test, and README. Do not change dependencies or out-of-scope token behavior.

## Risks And Rollback

The main rollout risk is mixed old/new revisions. Drain old revisions promptly. Roll back only to a durable-code-capable revision or temporarily constrain traffic to one instance as an explicit degraded control.
