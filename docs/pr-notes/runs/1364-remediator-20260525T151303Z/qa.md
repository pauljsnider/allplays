# QA

- Run the focused Parent Tools service unit test after the fix: `npx vitest run tests/unit/app-parent-tools-service.test.js --reporter=verbose`.
- Verify an adjusted positive-balance fee with a checkout URL maps to `canPay: true` and `paymentAction: checkoutUrl`.
- Verify adjusted zero-balance and terminal paid/canceled fees remain blocked.
