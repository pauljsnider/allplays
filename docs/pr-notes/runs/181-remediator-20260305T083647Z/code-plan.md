# Code role plan (inline fallback)

1. Extend `shouldRetryChatLastReadOnViewReturn` to require two new booleans:
   - `hasLoadedSnapshot`
   - `isAwaitingPostResumeSnapshot` (must be false)
2. In `team-chat.html`, track resume freshness lifecycle with module-level flags and wire them into retry calls:
   - set awaiting flag on visibility/focus return
   - clear awaiting flag after realtime snapshot callback executes
3. Update unit tests to cover the new gating behavior.
4. Run targeted unit tests and commit.
