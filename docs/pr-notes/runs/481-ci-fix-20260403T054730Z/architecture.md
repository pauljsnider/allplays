Objective: restore PR #481 preview smoke by fixing the failing statsheet apply smoke tests.

Current state: `tests/smoke/track-statsheet-apply.spec.js` seeds scenario state through `localStorage` after navigating to `about:blank`.
Proposed state: seed the same state after navigating to an app URL on the preview origin so storage access uses the same origin as the tested page.

Risk surface and blast radius:
- Scope is limited to a single smoke spec.
- No production runtime code changes.
- Main risk is masking a broader storage bug, but the CI log points to test setup rather than app logic.

Assumptions:
- `SMOKE_BASE_URL` is present in preview smoke runs.
- `track-statsheet.html` can be loaded safely before state seeding.

Recommendation:
- Use the preview origin for test seeding. This is the smallest change that preserves test intent and removes the cross-origin/restricted-document dependency.
