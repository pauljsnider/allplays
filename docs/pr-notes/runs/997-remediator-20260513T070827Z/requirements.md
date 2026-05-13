# Requirements notes

Acceptance criteria:
- Save Summary cannot be submitted more than once while an async `updateGame(...)` save is in flight.
- Closing and reopening the summary editor during an in-flight save must not re-enable Save Summary.
- After save success or failure resolves, Save Summary returns to the expected enabled state for the next user action.

Risk:
- Scope must stay limited to summary editor disabled-state behavior in `game.html`.
