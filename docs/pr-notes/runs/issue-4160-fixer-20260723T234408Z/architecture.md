# Architecture

## Current-State Read

- `oauth.js` owns process-local access and refresh maps.
- `server.js` constructs one broker per Node process.
- Refresh consume-and-reissue is not atomic across instances.
- Expiry is checked locally, with no durable cleanup policy.
- Persisting the current plaintext Firebase binding would increase blast radius.

## Proposed Design

- Inject an asynchronous grant store into `createOAuthBroker`.
- Add memory and Firestore REST implementations.
- Address documents by grant type plus `SHA-256(token)`.
- Encrypt Firebase refresh-token bindings with AES-256-GCM and bind authenticated
  metadata to the grant type, token digest, client, and expiry.
- Atomically create initial access/refresh records.
- Rotate refresh grants with one Firestore commit that conditionally deletes the
  predecessor by `updateTime` and creates both successors with `exists: false`.
- Reject expiry synchronously and best-effort delete expired records. Configure
  Firestore TTL on `expiresAt` for eventual cleanup.
- Require durable store and encryption configuration in production. Retain memory
  mode only outside production.
- Preserve direct Firebase bearer handling and propagate store failures closed.

## Files And Modules Touched

- `services/chatgpt-mcp/src/oauthStore.js`
- `services/chatgpt-mcp/src/oauth.js`
- `services/chatgpt-mcp/src/server.js`
- `services/chatgpt-mcp/README.md`
- `tests/unit/chatgpt-mcp-oauth.test.js`

## Data/State Impacts

- Durable records contain hashed identifiers, encrypted credential envelopes,
  type/client metadata, and Firestore timestamp expiry.
- Access grants remain one hour. Refresh grants remain 30 days.
- Existing process-local sessions are not migrated.

## Security/Permissions Impacts

- Cloud Run gains a dedicated service identity for the OAuth grant store.
- The identity should be least privilege and preferably isolated in a dedicated
  Firestore project/database.
- Secret Manager access is limited to the runtime service account and audited.
- No plaintext Firebase binding or raw broker token is persisted.

## Failure Modes And Mitigations

- Concurrent refresh replay: conditional atomic Firestore commit.
- TTL lag: request-time expiry enforcement.
- Store outage/decryption failure: fail closed without memory fallback.
- Key replacement: controlled revocation unless dual-key migration is added.
- Privileged identity blast radius: dedicated store and least-privilege IAM.
- #4159 overlap: authorization codes remain unchanged in this slice.
