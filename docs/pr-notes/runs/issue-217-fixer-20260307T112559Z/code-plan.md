Thinking level: medium
Reason: feature gap is broad, but the safe implementation slice is bounded to additive schedule metadata plus a pure advancement engine.

Plan:
1. Add failing unit tests for a new tournament bracket helper module and source-based integration checks in `edit-schedule.html` and `track-live.html`.
2. Implement `js/tournament-brackets.js` with normalization, slot resolution, winner resolution, and patch generation.
3. Update `edit-schedule.html` to expose tournament bracket metadata fields, persist them on game save, restore them on edit, and render bracket context on schedule cards.
4. Update `track-live.html` to recompute and persist bracket-resolution updates after a game is finalized.
5. Run targeted Vitest coverage, then commit all changes with an issue-referencing message.
