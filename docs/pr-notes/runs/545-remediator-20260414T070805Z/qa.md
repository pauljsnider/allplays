# QA

## QA Plan
- Run the targeted Vitest file covering help-page-reference integrity.
- If Playwright is available, run the targeted smoke spec against a local static server to confirm the stronger file-resolution assertion passes.

## Edge Cases
- Windows drive-letter paths such as `/C:/repo/...` must normalize before `resolve()` is used.
- `index.html` is a legitimate target and should not fail the rewrite comparison.
- Repeated files in workflow and page-reference sources should still be deduplicated before request checks.

## Recommendation
- Treat a non-index response body matching `/index.html` as a failure signal for missing static help files.
- Keep assertions focused on the help-center file list so the blast radius stays contained.
