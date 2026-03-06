Objective: preserve the saved live lineup when a coach resumes an in-progress game in `live-tracker.html`.

Current state:
- Resume restores scores, clock, and stats.
- Resume does not restore `game.liveLineup`.
- Tracker init then persists `state.onCourt=[]` and `state.bench=full roster`, wiping the saved lineup for all viewers.

Proposed state:
- When resuming, hydrate tracker lineup from persisted `game.liveLineup` if it exists.
- Keep lineup IDs ordered by the current roster and ignore invalid player IDs.
- Preserve current reset behavior for explicit "start over".

Risk surface and blast radius:
- High user impact today because resume can destroy live lineup context across tracker and viewer pages.
- Fix should stay inside live-tracker resume initialization and lineup sanitization only.

Assumptions:
- `game.liveLineup` is the durable source of truth for viewer lineup state.
- A valid basketball lineup may have fewer than 5 players if the saved state was partial.
- Roster order is the expected display order for restored on-court and bench lists.

Recommendation:
- Add a pure helper that sanitizes and restores persisted lineup data.
- Use it only in the resume path before the initial `updateGame(... liveLineup ...)` call.

Success criteria:
- Resume keeps prior `onCourt` and `bench` values instead of resetting them.
- Initial sync after resume re-persists the restored lineup, not an empty one.
- Invalid or duplicate IDs in saved lineup do not break tracker rendering.
