# Code Plan

## Implementation Plan
- Inspect `RegistrationDetail.tsx` import list and usage of `hasQuantityDiscountRule`.
- Inspect `js/registration-flow.js` exports for the helper.
- If missing, add a minimal named export near discount-rule helpers and add/update a regression test.
- Current workspace finding: no source edit needed. `hasQuantityDiscountRule` is already exported and the affected test mock includes the named export.

## Conflict Resolution
- The review comment says the helper is missing, but current branch evidence shows it exists. Treat this as stale/already-satisfied feedback rather than duplicating logic locally.
