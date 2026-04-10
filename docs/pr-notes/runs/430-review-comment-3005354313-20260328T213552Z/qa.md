## QA Role Summary

- Primary regression to cover: stat current value lower than logged undo value should emit only the remaining amount.
- Manual scenario:
  1. Record a +3 stat event for a player.
  2. Correct the stat down by 2.
  3. Undo the original +3 log entry.
  4. Verify local stat lands at 0 and the emitted reverse live event is `-1`, not `-3`.
- Additional check: point stats must roll back `homeScore` or `awayScore` by the same effective delta.
- Validation target: focused unit test plus targeted source inspection because this repo does not have an end-to-end automated tracker harness.
