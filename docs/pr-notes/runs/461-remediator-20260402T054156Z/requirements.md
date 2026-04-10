Objective: Remediate PR #461 review feedback in native standings tie resolution with the smallest safe change.

Thinking level: medium
Reason: single-module bug fix with ranking behavior implications and a focused regression test requirement.

Current state:
- `resolveTieGroup()` continues with the remaining multi-team tiebreakers after any partition split.
- A 3+ team tie that shrinks to 2 teams does not restart using `twoTeamTiebreakers`.

Required outcome:
- When a tie partition changes size, reselect the tiebreaker stack based on the new partition size.
- Preserve existing behavior for unresolved groups that stay the same size.
- Add regression coverage that fails under the current implementation and passes with the fix.

Assumptions:
- The intended rule is to restart evaluation from the beginning of the applicable stack for the new partition size.
- Existing legacy single-list configs must remain backward compatible via normalized fallback stacks.
