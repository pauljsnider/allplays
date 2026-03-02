# Code Role Plan (manual fallback)

## Minimal patch
1. Update unit test expectation in `tests/unit/auth-signup-parent-invite.test.js` to require rejection on profile-stage finalization failure.
2. Update `js/auth.js` parent-invite catch path to rethrow finalization failures (not only redeem-stage failures).
3. Run targeted vitest suites.
4. Commit with issue reference.

## Non-goals
- No refactor of parent-invite module contracts.
- No UI text changes.
