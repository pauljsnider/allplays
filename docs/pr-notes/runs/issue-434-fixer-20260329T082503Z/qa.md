# QA Role

## Coverage Goal
Guard against regressions where a multi-child family sees packet UI from the wrong child after filtering.

## Test Focus
- All players view shows both children and a `0/2` denominator before completion.
- Single-player filter scopes:
  - visible child buttons
  - `Applies to` text
  - completion denominator
- Completing one child only marks that child complete and preserves the other child as incomplete.
- Completion payload remains child-specific.

## Preferred Test Shape
- Unit tests around shared pure helpers and the completion request payload builder.
- Avoid brittle HTML snapshot tests.

## Residual Risk
- Full browser wiring of `#player-filter` is not exercised end-to-end here.
- Existing integration behavior is still dependent on the page calling the shared helpers correctly.
