# Architecture

Base SHA: `1604c95f66ced0086c8509976ddf0a4a69203e0c`

## Trust boundaries

- All client SDK writes are untrusted, including owner and admin clients.
- Cloud Functions Admin SDK writes are the only supported checkout-state writer.
- Existing recipient documents remain untrusted legacy input after rules deployment.
- Stripe is authoritative for session state, but returned URLs still require structural policy validation.

## Minimal design

Define one server-owned checkout field set used by Firestore create and update guards. Create rejects payloads containing protected fields. Update rejects any affected protected key, including nulling or deletion, while unchanged legacy values do not block unrelated authorized updates.

Before reuse, retrieve the persisted Stripe session ID. Require exact `https://checkout.stripe.com` origin, no credentials or explicit port, equal persisted/session URLs, open unpaid payment state, exact session ID, current amount, attempt token, and `product/teamId/batchId/recipientId/checkoutAmountCents` metadata. Return the retrieved Stripe URL, never an unchecked stored string. Validate fresh Stripe responses before writing or returning them.

## Failure policy

- Missing local candidate or definitively expired/missing Stripe session: create fresh.
- Active session with mismatched or poisoned metadata: fail closed to avoid a duplicate payment path.
- Ambiguous retrieval/provider error: fail closed as unavailable; do not create.
- Unsafe fresh Stripe response: fail closed before Firestore mutation.

## Production safety

- Authorization and selectors: applicable and fail closed at rules and callable boundaries.
- Stale-state validation: live Stripe retrieval precedes reuse; transaction revalidates recipient balance/access before persistence.
- Partial failure: Stripe creation can still precede a failed Firestore transaction, leaving an orphaned session, but it is never returned. Cross-system reservation redesign is outside this slice.
- Atomicity: recipient and audit writes remain one transaction.
- Privacy: do not log URLs, credentials, tokens, customer email, or full provider objects.
- Confirmation, retention, deletion, rate limits: unchanged or not applicable.

## Blast radius and rollback

The change affects client writes to team-fee recipients and the callable reuse branch only. Valid sessions remain reusable. Rollback is code/rules rollback with no migration, but it restores the trust-boundary defect.
