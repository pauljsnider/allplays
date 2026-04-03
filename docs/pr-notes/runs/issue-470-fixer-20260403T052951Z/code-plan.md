Thinking level: medium
Reason: cross-page browser mocking plus a small production seam is needed, but the flow is bounded.

Implementation plan:
1. Add `js/track-statsheet-apply.js` with:
   - included-row validation
   - duplicate roster mapping validation
   - aggregated stat payload generation
   - opponent stat snapshot generation
   - game update payload generation
2. Rewire `track-statsheet.html` to call the helper instead of constructing payloads inline.
3. Add `tests/smoke/track-statsheet-apply.spec.js` that:
   - mocks page modules
   - seeds track/game state in localStorage-backed fake Firestore data
   - exercises alert and confirm branches
   - verifies saved output on `game.html`
4. Run the targeted Playwright spec and the relevant unit suite.
5. Commit all changes with an issue-referencing message.
