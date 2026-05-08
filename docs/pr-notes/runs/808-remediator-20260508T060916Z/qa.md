# QA Notes

- Unit test cumulative payment behavior: prior $25 + new $25 against $50 balance returns `paid` and `amountPaidCents: 5000`.
- Unit test partial cumulative behavior remains not paid when cumulative amount is below balance.
- Regression: full one-time payment still marks paid.
- Run affected unit test file with Vitest.
