# Code Role (allplays-code-expert)

## Objective
Ship a minimal patch that prevents swallowed parent invite signup failures.

## Implementation Plan
1. Add a unit test file for `signup()` with module mocks for Firebase and DB dependencies.
2. Write a failing test proving `signup()` rejects when `redeemParentInvite()` throws in parent invite path.
3. Update `js/auth.js` parent invite catch block to rethrow after logging.
4. Re-run targeted test suite and commit test + fix together.

## Tradeoffs
- Keeps behavior strict only for parent invite linking path to match issue scope.
- Leaves existing non-parent error swallowing unchanged to avoid broad behavior changes.
