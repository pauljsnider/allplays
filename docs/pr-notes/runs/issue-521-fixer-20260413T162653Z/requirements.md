# Goal
Add integration-style unit coverage for the live tracker resume prompt reset path so reopening a game with prior tracked data and choosing Cancel reliably starts from zero without dropping linked opponent identity.

# User-facing expectations
- When prior tracked data exists, the tracker prompts whether to continue.
- Choosing Cancel means start over immediately.
- The visible scoreboard resets to 0-0 on the reopened tracker.
- Old player stats, opponent stats, and prior live events do not rehydrate.
- Linked opponent fields remain attached so the coach still sees the same opponent context.

# Acceptance criteria
- Reset flow deletes persisted `events`, `aggregatedStats`, and `liveEvents` docs for the game.
- Reset flow calls `updateGame` with zeroed scores, cleared `opponentStats`, `liveStatus: 'scheduled'`, `liveHasData: false`, reset live clock metadata, and `liveLineup` returned to full bench.
- Preserved fields include `opponent`, `opponentTeamId`, `opponentTeamName`, and `opponentTeamPhoto`.
- In-memory tracker state resets so rendered score shows `0 — 0` after init.
- Existing resume-path behavior remains unchanged when the user accepts resume.

# Edge cases
- Reset must tolerate missing collections and partial delete failures without crashing init.
- Reset should not repopulate stale opponent stats from old `liveEvents` after cleanup.
- Basketball default period remains `Q1` for this path.

# Non-goals
- No refactor of the full tracker init flow.
- No UI copy changes to the prompt.
- No change to finish/save workflows outside reset behavior.
