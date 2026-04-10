1. Update `js/game-day-rsvp-controls.js` so only `false` from `loadRsvps()` is treated as failure.
2. Re-render the RSVP panel after a successful reload so the controller remains correct even when callers only mutate state.
3. Bump the `game-day.html` import for `js/db.js` from `?v=15` to `?v=16`.
4. Run the affected unit test, the cache-bust guard, and the unit test CI command.
