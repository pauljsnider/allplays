# Risk Matrix

- High: cross-instance misses, double consumption, lost validation fields, credential crossover/leakage, expired or malformed record acceptance.
- Medium: conflict/outage misclassification, unbounded retention, access/refresh regression.
- Low: UI or sports-role behavior, which is out of scope.

# Automated Tests To Add/Update

- Create on broker/store A and exchange on independently constructed broker/store B.
- Race two brokers and assert one success, one `invalid_grant`, and permanent replay rejection.
- Cover expired, client mismatch, redirect mismatch, and wrong/missing PKCE verifier with fresh codes.
- Prove a failed validation attempt burns the code.
- Inspect Firestore persistence for hashed identifiers, encrypted credentials, retained binding fields, expiry, and conditional deletion.
- Cover memory eviction, Firestore conflict, Firestore outage, corrupt record, and wrong key where the adjacent harness supports them.
- Keep existing registration, access, refresh rotation, encryption, and production configuration tests green.

# Manual Test Plan

In isolated non-production infrastructure, authorize on instance A and exchange on B, then run a controlled two-instance race. Inspect Firestore for hashed code IDs, encrypted bindings, expiry, and TTL configuration.

# Negative Tests

Unknown, empty, consumed, expired, mismatched, tampered, and corrupt records issue no tokens. Conditional conflicts become `invalid_grant`; permissions, availability, and generic backend failures remain server errors.

# Release Gates

Run `npx vitest run tests/unit/chatgpt-mcp-oauth.test.js --reporter=verbose`. Tests must use independent brokers/store adapters, assert OAuth error codes, verify the conditional consume request, and prove no raw code or credential is persisted.

# Post-Deploy Checks

Canary cross-instance exchange and a controlled race. Monitor token endpoint errors, consume conflicts, authorization-to-token success, latency, expired-document growth, TTL cleanup, and isolated-database audit logs.
