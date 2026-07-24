# Code Plan

## Patch Plan

1. Add focused async regression tests for shared-store access, restart-safe
   refresh, atomic concurrent rotation, expiry cleanup, and encrypted records.
2. Add a dependency-free OAuth grant store using Node `crypto`, `fetch`, and the
   Cloud Run metadata service.
3. Inject the store into the broker and convert grant issuance, exchange, and
   access resolution to async.
4. Configure durable Firestore mode in `server.js`; production fails startup
   without complete durable/encryption configuration.
5. Document Firestore, TTL, IAM, Secret Manager, key rotation, rollback, and
   local memory mode.
6. Run the focused OAuth test file, the adjacent MCP core test if needed,
   `git diff --check`, and inspect the final diff.

## Code Changes Applied

None during role analysis. Only the main issue-fixer run edits files.

## Validation Run

- `npx vitest run tests/unit/chatgpt-mcp-oauth.test.js --reporter=verbose`
- `npx vitest run tests/unit/chatgpt-mcp-core.test.js --reporter=verbose` when
  server/broker identity wiring changes.
- `git diff --check`

## Residual Risks

- Authorization codes remain process-local under #4159.
- Firestore availability becomes part of OAuth availability.
- Replacing the encryption key without migration revokes existing grants.
- Deployed multi-instance behavior and IAM still require post-deploy verification.

## Commit Message Draft

`Persist ChatGPT OAuth grants across instances (#4160)`

## Synthesis

### Acceptance Criteria

Cross-instance access, restart-safe refresh, single-winner atomic rotation,
request-time expiry plus cleanup, encrypted Firebase bindings, and actionable
deployment configuration.

### Architecture Decisions

Use a Firestore REST adapter to match the existing dependency-free service,
hashed token document IDs, AES-256-GCM, Firestore conditional commits, and
explicit memory mode only for local/test.

### QA Plan

Test the store contract with independent brokers and the Firestore adapter's
encrypted write/conditional commit shape. Preserve existing OAuth regression
coverage after converting the broker API to async.

### Implementation Plan

Tests first, then the store, broker async conversion, server configuration, and
README. Keep authorization-code persistence outside this issue.

### Risks And Rollback

The main risks are Firestore availability, encryption-key loss, and incomplete
IAM/TTL provisioning. Roll back to a prior revision only with the documented
expectation that durable grants may require reconnect; never silently downgrade a
production revision to process memory.
