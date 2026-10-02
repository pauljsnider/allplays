# QA Strategy — Issue #4888

## Regression tests

1. Extend source-contract coverage to require a bounded leased `drainOrderedPages` pass, expiry ordering, explicit limit, cursor progression, path-based deduplication, and leased/aggregate reporting.
2. Add an integration scenario with 101 leased recipients so discovery spans three pages. Assert query limits, order, cursor chain, and the page-three result.
3. Make the leased records future-due and expired so they also appear in upcoming discovery. Assert each recipient route produces only one push and one inbox write despite appearing in both query populations.
4. Verify the final recipient is reclaimed, sent, retains its sent marker, and has delivery-claim fields finalized.
5. Assert leased, upcoming, and aggregate structured logs contain examined, sent, failed, pages, and stop reasons.

## Guardrails

- Deduplicate by full path, never recipient ID.
- Use expired rather than active leases for delivery assertions; active leases are expected retryable failures.
- Assert side effects and final document state, not only query shape.
- Retain the existing orphan-lease, ambiguous marker, interrupted finalization, and bounded-drain tests as retry/cap coverage.

## Focused validation

Run `functions/test/notification-triggers.test.js`, `tests/unit/fee-due-reminders-source.test.js`, and the existing `tests/unit/pre-event-reminder-dispatcher.test.js` bounded-drain tests.
