## Architecture Decisions
- Keep this fix test-only. `help.html` and `help-page-reference.html` are static shipped assets, so no product-page change is needed for this review item.
- Use Node-native file URL handling for repo-root discovery instead of `.pathname` string extraction.
- Prefer either direct `URL` objects passed to `readFileSync` / `existsSync`, or `fileURLToPath(new URL('../..', import.meta.url))` if the test stays string-path based.
- Do not bake in Windows-drive regex cleanup as the primary design. It is a tactical patch, not the most robust cross-platform pattern.

## Constraints
- Static site, no build step, root-level HTML pages are the source of truth.
- Tests must run under Node/Vitest across Linux, macOS, and Windows.
- The current failure comes from `new URL('../..', import.meta.url).pathname`, which becomes `/C:/...` on Windows and breaks `path.resolve(...)` plus downstream fs calls.
- Keep the change minimal and localized to `tests/unit/help-page-reference-integrity.test.js`, because the review issue is about test portability, not runtime behavior.

## Minimal Safe Change
- Replace the current repo-root initialization in `tests/unit/help-page-reference-integrity.test.js` with a cross-platform URL-safe approach.
- Best minimal design for this file is to use `fileURLToPath(import.meta.url)` plus `dirname(...)` and `resolve(...)`, or direct `URL` objects for fs calls.
- This is consistent with existing repo test patterns that already use `readFileSync(new URL(..., import.meta.url), 'utf8')`.
- If the team wants to preserve `path.resolve(...)`, use `fileURLToPath(new URL('../..', import.meta.url))` first, not `.pathname`.

## Risks And Rollback
- Risk is very low because the change affects only a unit-test helper.
- Main risk is choosing a regex-based Windows normalization workaround instead of a reusable cross-platform pattern.
- Rollback is trivial: revert the helper change in the test file only. No production rollback or content rollback is needed.
- This fix resolves the Windows portability issue, but it does not change broader smoke-test behavior or hosting rewrite behavior.
