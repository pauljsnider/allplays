# Architecture

## Current State
- `accept-invite.html` imports `./js/accept-invite-flow.js?v=5`.
- `tests/unit/accept-invite-page.test.js` already expects `?v=5` and passes.
- `tests/unit/admin-invite-signup-cache-busting.test.js` still expects `?v=4` and fails.

## Root Cause
- The cache-busting regression test is stale relative to the shipped page import and the newer page-level unit test.
- Runtime code and the broader test suite agree on version `v=5`; one targeted assertion was not updated.

## Minimal Fix
- Update the stale expectation in `tests/unit/admin-invite-signup-cache-busting.test.js` from `accept-invite-flow.js?v=4` to `accept-invite-flow.js?v=5`.

## Risks
- Low risk. This change only aligns the regression test with the current shipped import and does not alter runtime behavior.

## Rollback
- Revert the single assertion if a later change intentionally reverts the page import version.
