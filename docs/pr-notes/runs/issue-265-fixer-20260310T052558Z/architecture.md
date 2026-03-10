Objective: preserve correct write semantics and reduce blast radius from a secondary Firestore failure.

Current state:
- The page script awaits game cancellation and team-chat notification inside the same `try/catch`.
- The client therefore collapses two different failure domains into one fatal outcome.

Proposed state:
- Keep `cancelGame(...)` as the only required write for the cancel action.
- Execute chat notification as a second awaited step with its own error boundary.

Why this path:
- It is the smallest change that preserves current data model and UI structure.
- No backend change is required because the bug is in client-side error handling, not write semantics.

Control equivalence:
- No permissions are expanded.
- No additional writes are introduced.
- The change narrows false-negative UX without changing the committed game state behavior.

Rollback:
- Revert the helper module import and restore the previous inline handler if needed.
