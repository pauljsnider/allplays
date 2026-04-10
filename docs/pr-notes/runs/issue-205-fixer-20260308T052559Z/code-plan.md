Thinking level: medium
Reason: multiple modules share the same defective fallback; fix needs to stay small and testable.

Implementation plan:
1. Add `js/live-sport-config.js` to normalize sport names and resolve default period labels.
2. Add failing unit tests for soccer/baseball defaults and config-period precedence.
3. Replace hardcoded `Q1` fallbacks in:
   - `js/live-tracker-reset.js`
   - `js/track-live-state.js`
   - `js/live-game-state.js`
   - `js/live-tracker-resume.js`
   - `js/live-game.js`
   - `js/live-tracker.js`
4. Run targeted Vitest suites.
5. Commit with issue reference.

Out of scope for this patch:
- Baseball balls/strikes/outs/base-runner UI
- New Firestore fields for baseball/soccer situation state
- Large tracker UI refactor
