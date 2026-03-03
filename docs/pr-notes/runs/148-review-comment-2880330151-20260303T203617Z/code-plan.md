# Code Role Output

## Patch Plan
1. Replace current summary marker checks with one case-insensitive prefix matcher in ICS mapping.
2. Keep status normalization output contract unchanged.
3. Update targeted unit assertion to match new logic.

## Code Changes Applied
- Planned change in `calendar.html` around ICS `isCancelled` derivation.
- Planned update in `tests/unit/calendar-ics-cancelled-status.test.js` regex expectation.

## Validation Run
- `node ./node_modules/vitest/vitest.mjs run --root . tests/unit/calendar-ics-cancelled-status.test.js`

## Residual Risks
- Other pages contain independent cancellation parsing logic not part of this PR; unchanged intentionally for minimal blast radius.

## Commit Message Draft
`Harden ICS cancelled prefix detection for mixed-case markers`
