# Current-State Read

`createOAuthBroker()` owns a process-local authorization-code `Map`. Approval writes locally and exchange reads/deletes locally. Access and refresh grants already use injected memory and Firestore adapters with hashed identifiers, encrypted Firebase credential bindings, logical expiry, and TTL cleanup.

# Proposed Design

- Extend the existing store with `issueAuthorizationCode()` and `consumeAuthorizationCode()`.
- Make approval async and persist before returning the code.
- Consume before validating client, redirect, or PKCE to retain fail-closed burn-on-attempt behavior.
- Memory: use shared `authorizationCodes` state, prune expired records, enforce the existing hard bound, and synchronously read/delete.
- Firestore: use `code_<sha256(code)>`, encrypt the credential binding with authenticated immutable metadata, create with `exists=false`, and conditionally delete with `updateTime`.
- Reuse existing Firestore configuration, isolated database, encryption key, IAM, and TTL. Add no dependency.

# Files And Modules Touched

- `services/chatgpt-mcp/src/oauth.js`
- `services/chatgpt-mcp/src/oauthStore.js`
- `services/chatgpt-mcp/src/server.js`
- `tests/unit/chatgpt-mcp-oauth.test.js`
- `services/chatgpt-mcp/README.md`

# Data/State Impacts

New code documents share the OAuth collection and retain `type`, `clientId`, `redirectUri`, `codeChallenge`, `expiresAt`, and `encryptedBinding`. Raw codes and Firebase refresh tokens are not persisted. No migration is required because existing codes are ephemeral.

# Security/Permissions Impacts

The isolated OAuth store remains the only service-identity boundary. Expiry is checked synchronously; TTL is cleanup only. Wrong validation fields burn the code. Store unavailability fails closed and does not fall back to memory in production.

# Failure Modes And Mitigations

- Conditional-delete conflicts mean another exchange won and map to `invalid_grant`.
- Store outages propagate as server failures.
- Corrupt records fail closed.
- Grant issuance failure after consume leaves the code burned.
- Rollout should drain old revisions promptly because old instances still issue local codes.
- Rollback must retain the durable-store configuration and use a revision that supports durable code consumption.
