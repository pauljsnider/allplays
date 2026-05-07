# Architecture

## Decision
Keep `getFirstDefined()` unchanged for scalar aliases and add array-specific alias resolution for fee collections.

## Design
- Add a helper near `getFirstDefined()` that selects the first non-empty array candidate.
- Treat empty arrays as missing for line-item/installment alias fallback.
- Update only `getFeeLineItems()` and `getFeeInstallments()`.

## Blast Radius
Read/render behavior only in `js/parent-dashboard-fees.js`. No Firestore writes, rules, auth, or schema changes.

## Rollback
Revert the helper and restore the two functions to their previous `getFirstDefined()` calls. No data cleanup required.
