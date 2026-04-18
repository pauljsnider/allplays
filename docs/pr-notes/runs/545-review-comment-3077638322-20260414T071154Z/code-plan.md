## Implementation Plan
- Confirm the failure mode from `firebase.json`: hosting rewrites every unknown path to `/index.html`, so `response.ok()` alone is not a real page-integrity check on `allplays.ai`.
- Keep the fix test-only and localized to `tests/smoke/help-center.spec.js`.
- Strengthen the per-file fetch helper so each requested `.html` page proves it served its own content, not the SPA fallback.
- Use the smallest safe proof: fetch the page body, extract its served `<title>`, and compare it to the expected `<title>` from the repo source file.

## Candidate Test Files
- `tests/smoke/help-center.spec.js`
- `tests/unit/help-page-reference-integrity.test.js` for complementary repo-existence coverage

## Minimal Patch Shape
- Keep the existing `request.get(...)` loop over help/workflow/reference files.
- After `expect(response.ok())`, read `await response.text()`.
- Read the expected source file from disk.
- Extract `<title>` from both the served response and the source file.
- Assert the titles match with a failure message explaining this guards against `index.html` rewrite fallback.

## Risks
- Title-based validation assumes each checked page has a meaningful `<title>`.
- If two pages intentionally share the same title, the check weakens but is still better than `response.ok()` alone.
- If a future file omits `<title>`, the helper should fail clearly rather than silently passing.
