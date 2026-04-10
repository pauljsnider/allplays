# QA role (fallback synthesis)

## Regression risks
- Parent dashboard may fail to show RSVP state if per-child hydration logic is wrong.
- Latest-response precedence across multiple docs for same player must be deterministic.
- Team summary hydration must continue loading.

## Test strategy
- Add unit tests for new helper that resolves child-specific responses from RSVP docs:
  - Distinct sibling responses are preserved.
  - Latest timestamp wins for same child.
  - Other users' RSVP docs are ignored.
- Add/update unit tests for parent-dashboard RSVP submission scope to enforce single-child submissions from child-specific UI context.

## Validation commands
- `node ./node_modules/vitest/vitest.mjs run tests/unit/parent-dashboard-rsvp.test.js`
- Optional confidence run: `node ./node_modules/vitest/vitest.mjs run tests/unit/rsvp-hydration.test.js`

## Manual checks
- Parent with two children on same event: set child A Going, child B Can't Go; refresh page and verify both remain distinct.
- Coach RSVP breakdown counts both children in their selected buckets.
