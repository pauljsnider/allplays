# Requirements

## Acceptance Criteria
- Public player stat storage keys must match normalized stat definition IDs.
- Punctuated base stats such as `FG%` and `AST/TO` must be stored as slugified keys (`fg`, `astto`) so leaderboard reads by `definition.id` resolve recorded values.
- Private player stat detection continues to use slugified IDs and private stats remain separated.
- Existing derived leaderboard behavior remains unchanged.

## Feedback Classification
- `PRRT_kwDOQe-T586Emcbj`: actionable. Current public storage normalization preserves punctuation (`fg%`, `ast/to`) while base definitions use slugified IDs (`fg`, `astto`). This can make base top stats read as zero.
- Amazon Q review summary: non-actionable. It summarizes the current behavior and gives no required change.
