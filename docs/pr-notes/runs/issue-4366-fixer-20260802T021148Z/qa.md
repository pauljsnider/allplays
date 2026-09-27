# QA analysis

## Regression matrix

Cover a trusted canonical Stripe URL plus rejected HTTP, malformed, credential-bearing, non-Stripe, hostname-lookalike, nonstandard-port, root-only, and missing destinations.

For rejected values with complete context, assert no anchor or raw URL and assert the checkout retry button remains. Without complete context, assert visible recovery text and no navigable action. Preserve offline, payments-disabled, paid, canceled, adjusted, partial-balance, and zero-balance behavior.

## Focused validation

`npx vitest run tests/unit/parent-dashboard-fees.test.js --reporter=verbose`

## Recurrence risk

Medium before regression coverage because five legacy aliases converge into one rendered destination. A single validator plus table-driven render tests reduces the residual risk to low for this renderer.
