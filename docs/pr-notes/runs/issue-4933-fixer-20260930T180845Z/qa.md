# QA analysis

## Regression strategy

1. Use a page size of two and opaque cursors to assert `null -> cursor-1 -> cursor-2`, the exact limit on every load, and ordered processing.
2. Provide more full pages than a two-page cap and assert exactly two loads plus `stoppedBecause: 'maxPages'`.
3. Return mixed sent/failed page summaries and assert examined, sent, and failed totals across pages.
4. Assert a short final page reports `drained`, including when it occurs on the maximum allowed page.

Thrown loader or processor errors should not be converted into failures because doing so would weaken retry semantics.

## Focused validation

`npx vitest run tests/unit/pre-event-reminder-dispatcher.test.js --reporter=verbose`
