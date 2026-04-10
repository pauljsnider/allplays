# QA Role Notes

Test focus:
- Timestamp-like past/future and exact boundary.
- Date input boundary coverage.
- Numeric timestamp boundary coverage.
- Zero-millis value coverage.

Validation command:
- `node ./node_modules/vitest/vitest.mjs run tests/unit/access-code-utils.test.js`

Pass criteria:
- All tests pass.
- Boundary assertions confirm inclusive expiration semantics.
