Validation target: completed-game insight helpers should correctly classify scoring plays and opponent plays from persisted event documents.

Checks:
- `extractEventPoints` returns the persisted top-level `value` when `statKey` is a points field.
- `isOpponentEvent` honors the persisted top-level `isOpponent` boolean.
- Existing `undoData` fallback still works for live/in-memory event shapes.

Planned validation: run a focused Node import/execution against `js/post-game-insights.js` with both persisted and `undoData` event objects.
