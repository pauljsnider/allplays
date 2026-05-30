# Architecture Decisions

- Keep `buildManualPaymentUpdate` contract unchanged: `currentBalanceCents` represents total fee obligation for status and remaining-balance calculations.
- Fix the caller `recordOfflineTeamFeePayment` to pass `recipient.amountDueCents` so prior paid amount is not subtracted twice.
- Blast radius is limited to manual offline team fee payment updates in the React app service layer.
