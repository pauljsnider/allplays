# Implementation Plan
1. Update the unit test to derive `REPO_ROOT` via `fileURLToPath(new URL('../..', import.meta.url))`.
2. Update the smoke spec to fetch `/index.html` as the rewrite baseline, then assert each requested help file response body is HTML and differs from the fallback document.
3. Run the affected unit test and smoke spec only.

# Minimal Patch Scope
- `tests/unit/help-page-reference-integrity.test.js`
- `tests/smoke/help-center.spec.js`
- `docs/pr-notes/runs/545-remediator-20260414T070048Z/*.md`

# Validation Hooks
- `npm run test:unit -- tests/unit/help-page-reference-integrity.test.js`
- Local static server plus `npx playwright test tests/smoke/help-center.spec.js --config=playwright.smoke.config.js`
