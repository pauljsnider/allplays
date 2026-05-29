# QA

- Add regression coverage for online Stripe fee recipients with amountCents = 0 and with paidAmountCents equal to amountCents.
- Expected result: both remain visible as fee rows but canPayOnline is false, so the template does not expose checkout for them.
- Validation: run the focused TeamFeesComponent Vitest spec, then repository app validation where feasible.
