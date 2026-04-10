Implementation plan:
1. Add `js/parent-dashboard-practice-sessions.js` with a small helper for detecting cancelled linked practice sessions.
2. Add unit tests for the helper and a wiring test for `parent-dashboard.html`.
3. Update `parent-dashboard.html`:
   - import the helper
   - skip cancelled linked sessions in unmatched schedule fallback
   - load `getGames(teamId)` in packet builder and skip cancelled linked sessions there
4. Run focused Vitest coverage for the new and touched test files.
5. Commit all changes with an issue-referencing message.
