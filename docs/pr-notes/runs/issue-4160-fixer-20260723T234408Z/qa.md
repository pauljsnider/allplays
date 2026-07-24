# QA

## Risk Matrix

- High: concurrent refresh rotation permits replay.
- High: stored Firebase binding confidentiality and identity isolation.
- High: cross-instance and restart persistence.
- Medium: expiry/TTL timing and async server wiring.
- Medium: store failure must fail closed.
- Low: PKCE, metadata, registration, and direct Firebase bearer regressions.

## Automated Tests To Add/Update

- Two brokers sharing one store resolve access across instances.
- A recreated broker exchanges a pre-restart refresh token.
- Concurrent refresh exchanges yield one success and one `invalid_grant`.
- Expired access/refresh records are rejected before physical TTL deletion and
  cleanup is requested.
- Persisted records exclude plaintext Firebase bindings and raw broker tokens.
- Tampered/wrong-key ciphertext fails closed.
- Existing code exchange, PKCE burn, client mismatch, expiry, and metadata tests
  remain green after asynchronous conversion.

## Manual Test Plan

- Deploy two non-production instances and issue on A, authorize `/mcp` on B.
- Restart the revision and exchange a previously issued refresh token.
- Race two refresh requests and observe one 200 plus one `invalid_grant`.
- Inspect stored records/logs for absence of plaintext credentials and tokens.
- Verify parent and coach/admin accounts remain rules-scoped.

## Negative Tests

- Unknown, expired, rotated, malformed, and empty refresh tokens.
- Unknown and expired access grants.
- Concurrent rotation and failed successor writes.
- Wrong key, tampered envelope, corrupt record, store timeout, and permission
  failure.
- No production memory fallback.

## Release Gates

- Focused OAuth/store tests pass.
- MCP core tests remain green if server identity wiring changes.
- README documents store, IAM, TTL, encryption, rotation, and rollback.
- PR evidence includes root cause, prevention, regression tests, and recurrence
  risk.

## Post-Deploy Checks

- Repeat cross-instance, restart, and refresh-race tests.
- Monitor invalid-grant rate, transaction conflicts, store latency/errors,
  decrypt failures, `/mcp` 401s, and Cloud Run 5xx without logging secrets.
- Verify immediate logical expiry and later datastore cleanup.
