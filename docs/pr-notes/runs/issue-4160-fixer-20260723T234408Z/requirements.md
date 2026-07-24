# Requirements

## Problem Statement

Broker-issued access and refresh grants live in process-local `Map` objects. An
unexpired grant therefore stops working after a Cloud Run restart or when a
request reaches another instance. Refresh rotation is also a local read/delete
sequence, so two instances can accept the same refresh token.

## User Segments Impacted

- Coaches and parents lose connector access during scaling, deploys, or restarts.
- Program administrators inherit repeated reconnect and support toil.
- Operators cannot safely enable multi-instance production without durable,
  protected, and auditable grant state.

## Acceptance Criteria

1. An access token issued by broker A resolves through broker B sharing the
   durable store until expiry.
2. A refresh token survives broker recreation and can be exchanged after restart.
3. Concurrent refresh exchanges produce exactly one success, invalidate the
   predecessor atomically, and issue one valid successor pair.
4. Grants at or beyond expiry are rejected even if TTL deletion is delayed.
5. Expired records are cleaned up opportunistically and/or by datastore TTL.
6. The Firebase refresh-token binding is never stored in plaintext.
7. Missing or unusable production protection configuration fails closed.
8. Existing PKCE, token lifetimes, refresh rotation, and direct Firebase bearer
   behavior remain compatible.
9. Deployment documentation covers the store, TTL, IAM, encryption secret, key
   rotation, rollback, and production fallback policy.
10. Regression tests cover cross-instance access, restart exchange, atomic
    rotation, expiry cleanup, ciphertext-at-rest, and configuration failure.

## Non-Goals

- ChatGPT connector UX changes.
- Unrelated authentication migration.
- New MCP tools.
- Authorization-code durability, which remains tracked by #4159.
- Broad MCP service refactoring.

## Edge Cases

- Two instances rotate the same refresh token concurrently.
- A successor write fails after reading the predecessor.
- Firestore TTL deletion is delayed.
- Ciphertext is malformed, tampered with, or decrypted with the wrong key.
- Store/IAM failure must not downgrade to direct Firebase credential handling.
- Raw broker tokens, Firebase tokens, and encryption keys must not enter logs.

## Open Questions Resolved

- Durable store: Firestore through the service identity and REST API.
- Credential protection: AES-256-GCM using a base64-encoded 32-byte key supplied
  from Secret Manager.
- Lookup keys: SHA-256 digests of opaque broker tokens, never raw tokens.
- Failure model: durable production mode fails closed; memory mode is local/test
  only.

## Failing Invariant / Root Cause

An unexpired broker grant must be valid independent of process identity. The
broker instead owns local access/refresh maps, and refresh rotation has no shared
transaction boundary.
