# Patch Plan

1. Add focused jsdom regressions before production code changes.
2. Update only `bindTeamPassCheckoutButton()` with an explicit in-flight guard and complete attempt-state transitions.
3. Preserve `redirectToTeamPassCheckout()` and canonical Stripe validation unchanged.
4. Run only the focused Team Pass unit test.

# Code Changes Applied

- Planned `js/team-pass.js`: clear feedback on each attempt; synchronously guard, disable, set `aria-busy`, and show loading copy; on failure restore the label and enabled state while showing retryable feedback.
- Planned `tests/unit/team-pass.test.js`: loading, duplicate click, checkout error, retry, and invalid-destination recovery.

# Validation Run

`npx vitest run tests/unit/team-pass.test.js --reporter=verbose` passed with 19 tests. The expected missing vendor source-map warnings were non-fatal.

# Residual Risks

Low. The patch is isolated to one legacy CTA handler. A successful mocked redirect leaves the CTA busy by design because production navigation immediately follows.

# Commit Message Draft

`Add retryable Team Pass checkout states (#4751)`

# Synthesis

## Acceptance Criteria

The CTA has observable idle, pending, failure, retry, and validated-success transitions. Only one request may be pending, and all failures restore retryability.

## Architecture Decisions

Use local UI state and an explicit in-flight guard. Do not change backend behavior, eligibility, or canonical destination validation.

## QA Plan

Use deferred promises and sequential mock outcomes in the adjacent jsdom test file. Assert state before settlement and across failure/retry boundaries.

## Implementation Plan

Test first, patch the single handler, run the focused Vitest file, and commit all code, tests, and role artifacts together.

## Risks And Rollback

The primary risks are duplicate provider attempts and weakened destination validation. The explicit guard contains the first; retaining the existing redirect helper contains the second. Rollback is a single commit revert.

# Conflict Resolution

- Architecture required an explicit `inFlight` guard while the code role considered DOM disabling sufficient. Chosen: explicit guard because synthetic or reentrant events should not amplify checkout side effects.
- Requirements favored restoring the original CTA label while the code role suggested retry-specific button copy. Chosen: restore **Buy Team Pass** to preserve a stable action label; retryability is stated in the live error feedback.
- Requirements suggested loading feedback in both the button and live region. Chosen: button copy plus `aria-busy`, while clearing the live region, because that region is styled for errors and stale errors must disappear during retry.
