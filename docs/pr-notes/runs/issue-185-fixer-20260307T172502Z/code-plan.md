Implementation plan:
1. Add a failing test that passes empty or invalid `liveEvents` plus a valid persisted clock state.
2. Update `deriveResumeClockState` to use the persisted clock fallback when event-derived restoration fails.
3. Wire `live-tracker.js` to pass the current game doc live clock fields into the helper.
4. Run `vitest` for the resume test and the full unit suite.
5. Commit only the targeted fix, test, and run notes.
