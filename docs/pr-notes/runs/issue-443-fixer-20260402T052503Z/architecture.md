## Current State
- `js/native-standings.js` sorts rows with pairwise comparisons, which is insufficient for true multi-team tie groups.
- `edit-team.html` persists only `enabled`, `rankingMode`, and a single `tiebreakers` array.

## Proposed State
- Normalize standings config with:
  - `points`
  - `maxGoalDiff`
  - `twoTeamTiebreakers`
  - `multiTeamTiebreakers`
  - legacy `tiebreakers` fallback
- Replace pairwise-only tie handling with tie-group resolution that:
  - groups rows by primary metric
  - applies the appropriate ordered tiebreaker stack for that group size
  - uses mini-table summaries for head-to-head and group-head-to-head

## Why This Shape
- Group-based resolution fixes the core logic gap without changing unrelated team-page rendering.
- Backward-compatible normalization avoids breaking existing saved teams.
- Keeping the change inside the standings module and edit form preserves a small blast radius.

## Controls
- Deterministic fallback remains alphabetical.
- Capped differential is applied only to differential accumulation, not to raw scored/allowed totals.
- Unsupported tiebreakers are ignored rather than crashing standings calculation.
