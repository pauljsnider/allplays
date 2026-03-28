Thinking level: medium
Reason: targeted bug with existing helper-based architecture and a clear persistence regression.

Implementation plan:
1. Add a unit test file for a new lineup-restore helper. Run it before implementation so it fails.
2. Add `js/live-tracker-lineup.js` with a pure helper that restores and sanitizes persisted lineup state.
3. Import the helper in `js/live-tracker.js` and apply it inside the `shouldResume` branch before render/init sync.
4. Run targeted live-tracker unit tests, then the full unit suite if time and environment allow.
5. Commit all source, tests, and role notes together with an issue-referencing message.

Non-goals:
- No UI refactor.
- No changes to viewer-side lineup rendering.
- No changes to substitution logic beyond resume initialization.
