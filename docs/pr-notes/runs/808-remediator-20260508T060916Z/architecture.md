# Architecture Notes

- Keep the change inside the existing team fee admin helper and render path.
- Add current paid cents to the DOM dataset alongside current balance/status so the existing submit handler can pass complete recipient state into `buildManualPaymentUpdate`.
- Compute `totalPaidCents = currentPaidCents + newlyEnteredPaymentCents` in the helper, then derive status from total paid versus current balance.
- Preserve the Firestore update shape and avoid data model migrations.
