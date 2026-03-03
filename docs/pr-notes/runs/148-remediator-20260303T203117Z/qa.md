# QA role notes

## Assertions
- Mapping logic contains case-insensitive status check.
- Mapping logic contains case-insensitive summary-prefix check.
- Mapping logic does not rely on bare substring `includes('[CANCELED]')` directly on raw summary.
- Existing mapping to `status: isCancelled ? 'cancelled' : 'scheduled'` remains intact.

## Validation command
- `node node_modules/vitest/vitest.mjs run tests/unit/calendar-ics-cancelled-status.test.js`
