# Code Plan

1. Add `isPaymentPending()` helper to `TeamFeesComponent`.
2. Early-return from `handlePayFee` if `isPaymentPending()` is true.
3. Change the Pay button disabled binding to `isPaymentPending()`.
4. Update unit tests for the overlap guard and disabled binding.
