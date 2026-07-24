# Problem Statement

OAuth authorization codes are stored in a broker-local `Map`. A code issued on one Cloud Run instance cannot be exchanged on another instance or after a restart. The durable boundary must retain PKCE, client, redirect URI, expiry, and the verified Firebase credential binding while preserving single use.

# User Segments Impacted

- Coaches, parents, and admins need reliable ChatGPT connector setup regardless of request routing.
- Operators need restart-safe, replay-resistant, bounded authorization records without expanding the broker service identity's access to application data.

# Acceptance Criteria

1. A code created by broker A can be exchanged by broker B when both use the same durable store.
2. The record retains client ID, exact redirect URI, S256 challenge, absolute expiry, and Firebase refresh-token binding.
3. Two concurrent exchanges produce exactly one success and one `invalid_grant`; later replay also fails.
4. The first exchange attempt consumes the code, including failed client, redirect, or PKCE validation.
5. Unknown, expired, mismatched-client, mismatched-redirect, and failed-PKCE codes return `invalid_grant`.
6. Expiry is enforced synchronously even when TTL cleanup is delayed.
7. Memory storage remains cardinality-bounded; durable storage is time-bounded by the 10-minute lifetime and Firestore TTL.
8. Raw codes are not used as document identifiers and credential bindings are encrypted at rest.
9. Existing access-token, refresh-token, registration, direct-bearer, MCP tool, and UI behavior remains unchanged.

# Non-Goals

- Persisting broker access tokens or refresh tokens as part of this slice.
- Changing MCP tools, UI, clients, redirects, grant types, PKCE methods, or application permissions.
- Building a general-purpose OAuth storage framework.

# Edge Cases

- Cross-instance exchange, instance restart, simultaneous consume, exchange at exact expiry, invalid validation fields, corrupt storage, backend outage, random code collision, delayed TTL cleanup, and concurrent authorizations for different users.

# Open Questions

- Preserve the existing token-request contract: omitted client and redirect remain accepted, but supplied mismatches fail.
- Treat the durable bound as short validity plus TTL rather than a contention-heavy distributed record-count cap.
- Treat unusable/corrupt records as `invalid_grant`; propagate true store outages as server failures.
