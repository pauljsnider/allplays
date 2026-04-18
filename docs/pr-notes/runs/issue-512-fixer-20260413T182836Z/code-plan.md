# Issue #512 Execution Plan

## Acceptance Criteria
- Location link opens Google Maps without redirecting the current tab.
- Card clicks outside nested interactive elements still navigate to the team page.

## Architecture Decisions
- Keep the production change inside `teams.html`.
- Guard the card click handler instead of modifying routing or layout.

## QA Plan
- Add a focused Vitest unit test that proves card clicks navigate and nested link clicks do not.
- Run the targeted unit test file, then run the full unit suite if the changed area remains stable.

## Implementation Plan
1. Add a unit test that extracts the team-card click handler from `teams.html` and reproduces the bubbling bug.
2. Update the card click handler to return early when the event target is inside an interactive element.
3. Re-run the targeted test and the unit test suite.

## Risks And Rollback
- Risk: suppressing too many clicks could block intended navigation.
- Mitigation: use a conventional interactive selector and keep the patch isolated.
- Rollback: revert the `teams.html` listener change and the associated test if needed.

## Chosen Direction
Use a card-level guard for nested interactive targets. It is minimal, reversible, and less brittle than fixing only the current anchor.