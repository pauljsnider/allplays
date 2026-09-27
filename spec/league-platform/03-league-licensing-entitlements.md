# League Licensing and Entitlements

Status: Proposed

Depends on: [League foundation](./01-league-foundation.md)

## Objective

Control organization access to platform capabilities and capacity through durable entitlements while keeping purchasing state secure and operational access predictable.

## Requirements

1. An organization has one authoritative entitlement record with status, effective dates, enabled capabilities, capacity limits, and source provenance.
2. Feature checks must use server-issued entitlements, not client flags or UI visibility.
3. Existing core records remain readable during grace, suspension, or expiration; restricted mutations return clear recovery guidance.
4. Administrative overrides require elevated authorization, an expiration, a reason, and an audit trail.
5. Purchases and renewals must reserve the organization-wide effect before creating an external provider session.
6. Provider mutations require stable idempotency keys, exact request replay, and authoritative reconciliation after ambiguous responses. Canonical HTTPS destinations must pass the same allowlisted provider-host validation when first received, before persistence, and whenever returned from stored attempt state.
7. Provider session identifiers, payer details, tokens, request payloads, and bearer URLs remain in server-private attempt records for their full lifecycle.
8. A session created for one principal must never be returned to a different principal; delegated purchasing uses a non-bearer sign-in flow.
9. Entitlement changes publish idempotent events so dependent services can refresh without polling private provider data.
10. Capacity checks must define deterministic behavior for limits reached concurrently and must never silently remove existing access.

## Design

### Entitlement model

Keep the current organization entitlement small and readable by authorized administrators. Store immutable history and provider attempt state in private collections. Capabilities use stable keys and optional numeric limits so application code does not depend on provider product identifiers.

### Mutation protocol

A server operation creates or reuses a durable reservation, stores the exact provider request and initiating principal, invokes the provider with the reservation ID as the idempotency key, validates the response, and commits the result. Fresh and replayed destinations pass the same scheme, host, and canonicalization checks at their respective read boundaries. After any uncertain write or provider outcome, the operation re-reads authoritative state before returning, releasing capacity, or retrying.

### Enforcement

Expose a shared entitlement evaluator to server operations and read-only UI helpers. Server enforcement is decisive. The UI explains unavailable actions and current capacity without exposing purchasing secrets.

## Tasks

- [ ] Define entitlement, history, reservation, and private attempt schemas.
- [ ] Implement capability and capacity evaluation shared by server entry points.
- [ ] Build idempotent purchase, renewal, cancellation, reconciliation, and override operations.
- [ ] Add principal-bound session resolution and non-bearer delegated purchase links.
- [ ] Add organization settings UI for status, capabilities, capacity, and recovery actions.
- [ ] Add rules denying client access to private attempt state and bearer fields.
- [ ] Add concurrency, timeout, false-write, secret-rotation, cross-principal, and invalid stored-destination tests.
- [ ] Add provider event handling, audit history, metrics, and operator reconciliation tools.
