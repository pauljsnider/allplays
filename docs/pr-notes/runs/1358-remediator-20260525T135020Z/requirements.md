# Requirements

## Acceptance Criteria
- A cancellation request for a registration with `paymentStatus === 'paid'` must not mutate checkout or payment fields.
- The callable should still return `{ released: false, reason: 'already-paid' }` for paid registrations.
- Non-paid open checkouts still release capacity and apply the requested cancellation status.
