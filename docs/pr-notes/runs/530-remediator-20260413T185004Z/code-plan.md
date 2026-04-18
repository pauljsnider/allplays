## Target Files
- `tests/unit/teams-location-link-navigation.test.js`
- `teams.html` (reference only to confirm the exact selector already used in production)

## Minimal Patch
- Tighten the mocked `closest()` behavior in `tests/unit/teams-location-link-navigation.test.js` so it only returns a truthy value when the selector exactly matches `a, button, input, select, textarea, summary, [role="button"], [role="link"]`.
- Leave production code unchanged if `teams.html` already uses that exact selector.

## Validation Plan
- Confirm the selector string in `teams.html` matches the expected interactive selector.
- Re-read the test to verify the mock no longer passes on partial selector matches such as any string containing `a`.
- If a local unit test command is available in the PR branch, run the focused test file; otherwise document validation as static review only.

## Risks
- Low risk, test-only change.
- If the production selector changes later, this test will need to be updated to stay aligned.

## Rollback
- Revert the test mock change in `tests/unit/teams-location-link-navigation.test.js`.
