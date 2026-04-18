# Code Plan

## Implementation Plan
1. Update the unit test repo-root constant to normalize Windows drive-letter paths before calling `resolve()`.
2. Add a small smoke-test helper that fetches an HTML file, asserts success, and rejects non-index responses that match the deployed `/index.html` fallback.
3. Use that helper in the existing help-manifest/page-reference resolution loop.

## Minimal Patch Scope
- `tests/unit/help-page-reference-integrity.test.js`
- `tests/smoke/help-center.spec.js`
- `docs/pr-notes/runs/545-remediator-20260414T070805Z/*.md`

## Validation Notes
- Primary validation: `npm run test:unit -- tests/unit/help-page-reference-integrity.test.js`
- Secondary validation if available: local static server plus `npx playwright test tests/smoke/help-center.spec.js --config=playwright.smoke.config.js`
