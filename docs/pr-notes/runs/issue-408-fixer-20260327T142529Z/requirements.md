Objective: cover completed Live Game Video replay flows with automated tests that prove replay entry, final-score fallback, and timed chat behavior.

Current state:
- Replay is a required spectator workflow in `spec/live-game-tracker/requirements.md`.
- Existing automated coverage only touches `isViewerChatEnabled()` and replay speed math.
- The completed-game replay boot path in `js/live-game.js` has a no-play-by-play branch and timestamp-based chat timing with no direct tests.

Proposed state:
- Add unit coverage for replay bootstrap behavior when a completed game has no play-by-play events.
- Add unit coverage for replay timeline gating so events advance in order and chat only appears when replay time reaches the original timestamps.

User-facing acceptance:
- Completed games still expose replay with authoritative final scores even if replay events are missing.
- Replay mode keeps the composer disabled.
- Replay timeline reveals chat and reactions only when the simulated clock reaches their original timestamps.

Assumptions:
- Unit coverage is the fastest safe path in this repo.
- The existing static-page architecture is better served by pure helper tests than by adding heavy browser harnessing in this fix.
