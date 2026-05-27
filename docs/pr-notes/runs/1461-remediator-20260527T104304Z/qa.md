# QA

## QA Plan
- Verify the named export directly with Node ESM import: `import('./js/registration-flow.js')` and assert `typeof hasQuantityDiscountRule === 'function'`.
- Run the affected registration detail unit test file: `npx vitest run tests/unit/app-registration-detail.test.jsx --reporter=verbose`.

## Evidence
- Direct module import check passed: `hasQuantityDiscountRule export ok`.
- Targeted Vitest passed: `tests/unit/app-registration-detail.test.jsx`, 16 tests passed.
