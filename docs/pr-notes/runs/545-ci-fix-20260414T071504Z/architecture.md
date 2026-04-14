# Acceptance Criteria
- The help-center smoke test still validates that every help workflow file and page-reference file resolves successfully.
- The test no longer treats `index.html` as a candidate that must differ from `index.html`.
- The fix stays limited to the failing preview-smoke coverage.

# Architecture Decisions
- Keep the product HTML files unchanged because the failure is in test logic, not site behavior.
- Preserve the explicit `index.html` fetch as the canonical comparison target.
- Exclude only the self-comparison case from the non-rewrite assertion.

# Risks And Rollback
- Risk is low because the change affects only smoke-test expectations.
- Rollback is a single-file revert of `tests/smoke/help-center.spec.js` if the assertion change proves too permissive.
