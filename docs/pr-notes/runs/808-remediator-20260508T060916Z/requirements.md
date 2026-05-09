# Requirements Notes

- Manual payment updates must evaluate paid status against cumulative paid amount, not only the newly entered payment.
- Prior partial payments must count toward the total. Example: $25 paid against a $50 balance, then another $25 should transition the recipient to `paid`.
- Partial payments below the balance should remain `unpaid`, or remain `adjusted` when the current status is adjusted and not fully paid.
- The persisted recipient `amountPaidCents` should represent cumulative paid cents so summaries and outstanding calculations stay correct.
