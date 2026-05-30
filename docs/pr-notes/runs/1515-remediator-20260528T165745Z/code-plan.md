# Code Plan

- Change `recordOfflineTeamFeePayment` to pass `recipient.amountDueCents` into `buildManualPaymentUpdate.currentBalanceCents`.
- Add regression coverage in `tests/unit/app-team-fees-service.test.ts` asserting status remains `partial`, paid is cumulative, and remaining balance is based on total due.
- Commit source, test, and role-note artifacts.
