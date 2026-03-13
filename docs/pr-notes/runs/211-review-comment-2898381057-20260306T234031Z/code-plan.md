Objective: implement the smallest safe fix for PR #211 review comment `r2898381057`.

Planned change:
1. Add a pure helper that decides whether playback transport changed between two resolved video states.
2. Update `setupVideoPanel()` to preserve existing `iframe.src` / `video.src` when transport is unchanged.
3. Add Vitest coverage for unchanged-source and changed-source cases.

Why this path:
- Keeps behavior explicit and reviewable.
- Avoids larger lifecycle refactors in `live-game.js`.
- Matches the reported failure mode directly.

Constraints:
- No edits in the dirty primary checkout.
- Use the isolated PR worktree only.

Role resolution note:
- The requested orchestration skills and session-spawn capability are unavailable in this runtime.
- These artifacts capture the equivalent requirements, architecture, QA, and code lanes for traceability.
