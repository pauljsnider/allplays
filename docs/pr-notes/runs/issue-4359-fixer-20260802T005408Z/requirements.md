# Problem Statement

Staff share and copy actions currently trust an open recipient's locally loaded `checkoutUrl`, which may have been normalized from poisoned `checkoutUrl`, `paymentLink`, or `paymentUrl` metadata. The required invariant is that no team-fee checkout destination crosses the share or clipboard boundary unless it was resolved through the current server checkout operation and independently verified as a canonical HTTPS Stripe Checkout URL.

# User Segments Impacted

- Coaches and team fee administrators need fast sharing without manually inspecting URLs.
- Team owners need assurance that mutable recipient metadata cannot redirect families to an attacker-controlled payment page.
- Parents and guardians must be able to trust a staff-shared payment destination.
- Program managers need a recoverable failure that blocks distribution without corrupting fee state.

# Acceptance Criteria

1. Share and copy always invoke the server team-fee checkout operation, even when stored metadata reports an active link.
2. Stored `checkoutUrl`, `paymentLink`, and `paymentUrl` values never flow directly to share or clipboard APIs.
3. Only an absolute HTTPS URL on the exact `checkout.stripe.com` host, without credentials or a nonstandard port, may be distributed.
4. Poisoned stored metadata is ignored in favor of a valid server-returned destination.
5. Invalid server responses fail closed before any external action and show a recoverable recipient-level error.
6. Valid server regeneration and valid server reuse continue to work for both share and copy.
7. Paid, cancelled, offline-only, and unauthorized recipient behavior remains unchanged.

# Non-Goals

- Parent Pay rendering or navigation.
- Firestore security rules.
- Stripe session creation, reuse, expiration, or webhook behavior.
- Repairing poisoned stored metadata.

# Edge Cases

- Empty, whitespace, malformed, relative, HTTP, credential-bearing, or non-Stripe server responses.
- Lookalike hosts such as `checkout.stripe.com.attacker.example`.
- An open stored recipient URL pointing to an attacker host.
- A server-generated replacement for poisoned metadata.
- A server-reused valid existing Stripe Checkout Session URL.
- Native share cancellation or clipboard/share failure after validation.

# Open Questions

- `buy.stripe.com` is intentionally excluded because this flow creates Checkout Sessions, not Payment Links.
- Server-side binding of a canonical-looking URL to the actual Stripe session remains part of the parent server-authoritative work.
