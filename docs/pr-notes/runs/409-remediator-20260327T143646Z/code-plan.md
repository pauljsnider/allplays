Implementation plan:
1. Add a small helper in `js/live-game.js` to process replay event windows sequentially, one event at a time.
2. Use that helper from `seekReplay` so reset boundaries are re-evaluated as each event is applied.
3. Leave normal playback and live subscriptions unchanged unless inspection shows they share the same bug.
