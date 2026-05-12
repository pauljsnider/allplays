# Requirements

## Acceptance Criteria
- When a manager checks Public leaderboard Top Stat in the stat definition helper, the helper must reject the definition before adding or updating the textarea unless visibility is `public` and scope is `player`.
- Invalid Top Stat entries must show a clear alert explaining the required public/player combination.
- Existing form-submit validation remains in place as a safety net for pasted or manually edited definitions.
