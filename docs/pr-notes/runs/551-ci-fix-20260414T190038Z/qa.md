# QA

## Test Impact
- One failing unit test asserts the cache-busted `accept-invite-flow.js` import version in `accept-invite.html`.
- Another unit test already validates the same page against `?v=5`, which indicates the failing test is the outlier.

## Required Validation
- Run `vitest` for `tests/unit/admin-invite-signup-cache-busting.test.js`.
- Run `vitest` for `tests/unit/accept-invite-page.test.js` to confirm the aligned expectation still matches page behavior.

## Regression Risk
- Very low. Validation is limited to cache-busting assertions and does not exercise unrelated product flows.
