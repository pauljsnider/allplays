Decision: apply a minimal smoke-test-only patch.

Implementation:
1. Remove the inline `buildUrl` helper from `tests/smoke/footer-support-links.spec.js`.
2. Import `buildUrl` from `tests/smoke/helpers/boot-path.js`.
3. Add one focused regression test that asserts `buildUrl()` preserves a base pathname for absolute paths.
4. Run the footer smoke spec and inspect the diff before committing.

Non-goals:
- No product code changes.
- No smoke workflow expansion.
- No changes to unrelated smoke specs already using the shared helper.
