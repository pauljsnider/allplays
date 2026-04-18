# Acceptance Criteria
- Fix the preview-smoke failure without modifying application behavior.
- Change only the smoke assertion logic needed to avoid the false positive on `index.html`.
- Commit the scoped CI fix on the current branch.

# Implementation Plan
1. Update `tests/smoke/help-center.spec.js` so the rewrite-to-index assertion is skipped when `file === 'index.html'`.
2. Keep the request-success and HTML-content assertions for all files, including `index.html`.
3. Validate the targeted smoke spec locally after ensuring Playwright Chromium is installed.
4. Commit the change with the required `fix:address-ci-failure:` prefix.

# Risks And Rollback
- Risk is minimal because only test code changes.
- Roll back with a revert of the smoke spec change if needed.
