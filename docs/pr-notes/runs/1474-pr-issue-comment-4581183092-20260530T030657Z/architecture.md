# Architecture Role

## Decisions
- Keep the fix inside the existing static `track-live.html` orchestration path because it owns DOM input, score state, game log, stat buckets, sync scheduling, and live broadcasting.
- Keep pure scorer resolution in `js/live-scorekeeping-goal-sports.js` and add a side-specific wrapper in the tracker.
- Validate non-empty scorer input before score mutation. Blank scorer bypasses player stat mutation by design.
- Roll back scorer stats inside the existing `undoData.type === 'goal'` branch using existing stat buckets and sync functions.

## Blast Radius
- Limited to goal-sport live scoring and goal undo behavior.
- No Firestore schema, rule, index, Firebase project, or routing changes.
- Specialized basketball, baseball, volleyball, and football flows remain untouched.

## Rollback
- Revert the tracker/test commit. Existing behavior restores but reintroduces invalid scorer attribution and inflated scorer stats after undo.
