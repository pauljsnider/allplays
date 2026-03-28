Decision: restore a single shared formatter in `game.html` script scope.

Why:
- The regression is pure JavaScript scope breakage introduced by refactoring.
- Hoisting preserves current output formatting and minimizes change surface.
- Pulling the helper into a new module would improve testability but increases churn for a one-line behavioral fix.

Controls:
- No data model change.
- No network or Firebase call change.
- Blast radius stays inside the completed-game report render path.

Rollback:
- Revert the helper hoist if unexpected formatting regressions appear.
