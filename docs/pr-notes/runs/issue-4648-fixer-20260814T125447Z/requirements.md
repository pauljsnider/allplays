# Problem Statement

Team fee creation uses one atomic Firestore batch containing one fee-batch document plus one document per recipient. Firestore permits 500 writes, so 500 recipients require 501 writes and fail with a provider-level error. React/Capacitor and legacy workflows currently allow this invalid submission without actionable guidance. Recipient IDs must be normalized and deduplicated before evaluating a shared maximum of 499 valid recipients.

# User Segments Impacted

- Coaches need whole-roster charging to fail predictably before writes and explain how to proceed.
- Team and global admins need consistent validation with no partial or phantom batch.
- Sports program managers need reliable handling of large programs and clear operational guidance.
- Parents must not see nonexistent, duplicated, or partial fee assignments.

# Acceptance Criteria

1. Exactly 499 distinct valid recipients creates one batch document plus 499 recipient documents.
2. 500 or more distinct valid recipients rejects before Firestore batch allocation or commit and performs zero writes.
3. The error states the 499-recipient maximum and instructs the admin to split the roster into smaller fee batches.
4. Recipient IDs are trimmed, blanks removed, and duplicates collapsed before counting and persistence.
5. The first authoritative record wins deterministically when normalized IDs collide.
6. No valid recipient IDs rejects before writes.
7. The shared persistence boundary remains authoritative even if a caller omits validation.
8. React whole-roster creation counts distinct active valid players and preserves the shared limit.
9. Legacy creation counts distinct active valid selections and preserves the shared limit.
10. Rejected React and legacy submissions show no success state, do not navigate, retain form state, restore controls, and remain retryable.

# Non-Goals

- Chunking or resumable server-side bulk creation.
- Automatic roster partitioning.
- Stripe, payment fulfillment, read pagination, authorization-rule, or fee-management changes.

# Edge Cases

- 500 raw entries that normalize to 499 distinct IDs succeed.
- 500 distinct IDs plus duplicates still reject.
- Blank, null, missing, inactive, and whitespace-only IDs do not inflate the limit.
- Installment-plan fees use the same recipient ceiling.

# Open Questions

- Conflict resolution for duplicate metadata: use the first authoritative active-roster record and test it.
- Optional proactive warnings are useful, but the shared submission guard is the required authority.
- Stable error copy: “A fee batch can include at most 499 recipients. Split the roster into smaller fee batches and try again.”
