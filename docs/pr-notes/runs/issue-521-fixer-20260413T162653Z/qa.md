# Coverage gap
The repo had helper coverage for reset payloads and resume clock behavior, but no test that drove `js/live-tracker.js` through the real resume prompt reset path when prior game data already exists.

# Test strategy
- Add a Vitest harness test that rewrites `live-tracker.js` imports, boots `init()`, and stubs Firestore reads/writes.
- Seed a game with scores, `liveHasData`, linked opponent fields, stale `opponentStats`, aggregated stats docs, event docs, and live event docs.
- Stub `confirm()` to return `false` so the tracker chooses start over.

# Assertions that must hold
- `deleteDoc` is called for `events`, `aggregatedStats`, and `liveEvents` docs.
- `updateGame` receives zeroed score/live metadata and cleared `opponentStats`.
- `liveLineup` resets to bench roster.
- Preserved opponent linkage fields remain present.
- Rendered score line is `0 — 0`.
- Old opponent stat totals do not rehydrate into state after init.
- Reset broadcast payload remains canonical.

# Regression risks
- Resume-accept path should still restore prior state.
- Reset should not regress existing helper tests around reset events, resume clock state, or lineup restore.

# Validation commands
- `npx vitest run tests/unit/live-tracker-start-over.test.js`
- `npx vitest run tests/unit/live-tracker-start-over.test.js tests/unit/live-tracker-reset.test.js tests/unit/live-tracker-resume.test.js tests/unit/live-tracker-opponent-stats.test.js tests/unit/live-tracker-lineup.test.js tests/unit/live-tracker-integrity.test.js tests/unit/live-tracker-finish.test.js tests/unit/live-tracker-save-complete.test.js tests/unit/track-live-state.test.js tests/unit/track-live-reset-persistence.test.js`
