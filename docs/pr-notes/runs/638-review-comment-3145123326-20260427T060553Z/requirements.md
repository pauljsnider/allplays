# Requirements

## Acceptance Criteria
- Included, mapped score-sheet players count as game participants even when all stats are `0` and tracked time is `0` or absent.
- Unchecked or unmapped score-sheet rows remain non-participants.
- Player profile games played and season averages distinguish “appeared with no recorded stats” from “did not play.”
- Explicit DNP records remain excluded regardless of stats, time, or import provenance.
- Existing time-based insights must not imply minutes were logged for zero-time appearances.

## Requirements Risks
- Inferring participation from stats/time alone is too weak for score-sheet imports.
- Broadening participation without an explicit marker could count placeholder aggregate docs.
- Parent/coach trust risk: low-stat players who appeared can disappear from profile history.
