# Problem Statement

React/Capacitor team-fee management pays for one private `adminBilling/latest` read per flagged recipient even though its model discards that metadata. The optimization must remove this N+1 fan-out only for React and preserve legacy reconciliation and online-refund behavior.

# User Segments Impacted

- Coaches and admins: faster large-batch loading with lower Firestore read pressure.
- Parents: no direct behavior change; parent-safe fee data remains authoritative.
- Legacy managers: reconciliation notes and Stripe refund eligibility remain available.

# Acceptance Criteria

1. React performs one `feeRecipients` query and zero `adminBilling/latest` reads for 100 flagged recipients.
2. The lightweight loader returns all recipients with unchanged ordering and parent-safe fields.
3. React preserves status, balances, checkout state, ledger entries, totals, and available actions without `adminBilling`.
4. The two-argument legacy loader call still hydrates flagged recipients by default.
5. Legacy management still renders a hydrated reconciliation note and online-refund controls.
6. Authorization and empty-batch behavior remain unchanged.

# Non-Goals

- Pagination or recipient collection redesign.
- Stripe checkout/refund changes.
- Firestore rules, authorization, or schema changes.
- UI redesign or platform-specific branches.

# Edge Cases

- Zero or mixed flagged recipients.
- Explicit versus derived remaining balances.
- Paid, partial, canceled, adjusted, and refunded statuses.
- Missing or unreadable legacy billing documents remain fail-soft.
- No selected batch performs no recipient read.

# Open Questions

None blocking. The option must be explicit at the React call site and default to legacy hydration.
