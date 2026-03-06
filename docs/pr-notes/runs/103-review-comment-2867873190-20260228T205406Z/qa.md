# QA Role Notes

## Test Strategy
- Run focused unit suite for ICS timezone parsing.
- Validate both supported and unsupported `shortOffset` behaviors.

## Regression Guardrails
- Existing tests cover TZID conversion, UTC Z, numeric offsets, invalid TZID, DST gap handling.
- Added test covers `RangeError` throw path for old-browser compatibility.

## Pass Criteria
- `tests/unit/ics-timezone-parse.test.js` passes fully.
- Expected UTC instant output for `America/New_York` sample remains unchanged.

## Residual Risk
- No browser matrix run executed in this lane; runtime compatibility inferred via unit simulation.
