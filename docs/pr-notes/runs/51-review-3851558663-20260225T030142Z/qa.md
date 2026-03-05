# QA Role (allplays-qa-expert)

## Objective
Prevent regressions in markdown/safe-text rendering while proving malformed URL tokens are not linkified.

## Risk-Based Test Focus
- Positive: Valid URL still linkifies.
- Negative: Malformed URL (`https://example..com/path`) is left as plain text.
- Boundary: Sentence punctuation is not included in href.
- Security invariant: Escaped script markup remains escaped.

## Validation Commands
- `npm test -- tests/unit/drills-issue28-helpers.test.js`

## Acceptance Criteria
- Updated helper unit suite passes.
- No new failures in touched behavior.
