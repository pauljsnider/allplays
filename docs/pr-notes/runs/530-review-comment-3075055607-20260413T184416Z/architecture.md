## Acceptance Criteria
- Production behavior in `teams.html` remains unchanged because the shipped click guard already checks the intended interactive selector.
- The unit test must only return a truthy `closest()` result when the selector exactly equals `a, button, input, select, textarea, summary, [role="button"], [role="link"]`.
- The test must fail if the mock uses loose partial matching that could mask a broken nested-link guard.

## Architecture Decisions
- Treat this as a test-contract correction, not a production architecture change.
- Keep `teams.html` as the source of truth for the interactive selector contract.
- Align the test mock to the exact selector string used by the card click guard.

## QA Impact
- Validation focuses on preserving existing card navigation while proving nested interactive elements bypass card-level routing.
- Main QA risk is future selector drift between `teams.html` and the unit test.

## Implementation Notes
- Update only `tests/unit/teams-location-link-navigation.test.js`.
- Replace the loose `selector.includes('a')` mock behavior with exact selector equality.
- Keep the patch minimal and reversible.

## Risks And Rollback
- Risk is low because the change is test-only.
- If the selector changes intentionally later, the test must be updated in the same change.
- Rollback is a simple revert of the test file and run-note artifacts.
