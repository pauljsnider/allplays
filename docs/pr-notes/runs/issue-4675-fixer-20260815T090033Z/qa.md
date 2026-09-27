# QA Plan

## High Risks

- Preview uses persisted rather than unsaved values.
- Preview invokes persistence, submission, or checkout.
- Public unpublished access weakens.

## Automated Coverage

1. Extend `TeamRegistrationForms.test.tsx` to edit unsaved parent-visible values, open preview, verify every section, close it, and prove the save service was not called.
2. Cover new, draft, published, and closed states plus the existing unauthorized boundary.
3. Verify inactive choices are absent and submit or checkout controls do not exist.
4. Strengthen the existing direct public-loader service test for draft and closed rejection.
5. Add a 390x844 Playwright smoke path that opens preview, verifies content, checks page and preview-panel overflow, and proves no save call.

## Release Gates

- Focused component test passes.
- Focused public-loader unit test passes.
- Focused responsive smoke passes.
- App build passes for TypeScript and import validation.
