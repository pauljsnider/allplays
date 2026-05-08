# Code Plan

- Update `buildManualPaymentUpdate` in `js/team-fees-admin.js` to accept `currentPaidCents` and calculate cumulative paid cents.
- Render `data-paid-cents` on each fee recipient article and pass it from the submit handler.
- Prefer the outstanding balance as the manual payment input default so coaches are prompted for the remaining amount.
- Extend `tests/unit/team-fees-admin.test.js` for cumulative partial payments.
