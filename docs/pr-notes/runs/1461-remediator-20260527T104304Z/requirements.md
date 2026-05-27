# Requirements

## Acceptance Criteria
- `apps/app/src/pages/RegistrationDetail.tsx` can import `hasQuantityDiscountRule` from `js/registration-flow.js` without a browser/Vite named-export failure.
- Quantity input is shown only when normalized active quantity discount rules exist.
- Existing registration detail quantity and checkout behavior remains covered by unit tests.

## Review Item Classification
- Thread `PRRT_kwDOQe-T586FCxEk`: non-actionable in the checked-out workspace. `js/registration-flow.js` already exports `hasQuantityDiscountRule` and the module import resolves in Node ESM.
