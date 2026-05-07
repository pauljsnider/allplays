# QA Plan

Automated test runner is not defined for this static site. Validate with direct code inspection and syntax parsing.

## Cases
- `lineItems: []`, populated `invoiceLineItems` falls back and renders rows.
- populated `lineItems`, populated `invoiceLineItems` keeps `lineItems` as winner.
- `installments: []`, populated `installmentSchedule` falls back and renders schedule.
- populated `installments`, populated `installmentSchedule` keeps `installments` as winner.
- both aliases empty/missing returns an empty array without errors.

## Validation
- Run JavaScript syntax validation on `js/parent-dashboard-fees.js` with Node module import/parse check where possible.
- Inspect diff to confirm only scoped alias fallback code changed.
