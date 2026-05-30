# Requirements

- Acceptance: recording an offline payment must add the new payment to prior paid cents and compare against the recipient's total amount due, not only the current outstanding balance.
- Regression: $100 due, $60 paid, $10 new offline payment remains partial with $70 paid and $30 remaining.
- Scope: address review thread PRRT_kwDOQe-T586FX3bZ only; no unrelated fee model changes.
