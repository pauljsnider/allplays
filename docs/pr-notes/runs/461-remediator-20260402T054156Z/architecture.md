Current state:
- `js/native-standings.js` already distinguishes two-team and multi-team tiebreaker stacks.
- That distinction is bypassed after a partition split because recursion carries `rest` from the previous stack.

Proposed state:
- Keep the existing recursive resolver.
- On a successful split, recurse each partition with `getApplicableTiebreakers(config, partition.length)` instead of the previous `rest`.
- Keep the current `rest` behavior only when the active tiebreaker is unsupported or fails to split the group.

Risk surface and blast radius:
- Blast radius is limited to standings ordering for tied groups in native standings.
- Main regression risk is changing behavior for partitions that intentionally should continue within the same stack; the test should pin the desired restart behavior.
