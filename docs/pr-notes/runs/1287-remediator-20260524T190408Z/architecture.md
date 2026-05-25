# Architecture

Decision: keep the single `pendingPaymentFeeId` as the checkout lock and selected-fee loading indicator.

Implementation:
- Add a component-level pending predicate based on `pendingPaymentFeeId !== null`.
- Guard `handlePayFee` before mutating state so overlapping calls return immediately.
- Disable all Pay buttons while any checkout is pending, while `isPaymentLoading(fee.id)` continues to scope the loading label to the selected fee.

Risk and rollback: minimal component-only change. Roll back by reverting this commit.
