# Architecture

- `game-plan.html` imports and calls `normalizeLineupsForGamePlanPlanner` during `loadGame` to normalize persisted lineup keys.
- The switching test extracts `loadGame` with `new Function(...)`, so the harness must explicitly bind imported module helpers into the generated function scope.
- Current branch already injects `normalizeLineupsForGamePlanPlanner` from `deps` into the harness, matching the existing dependency injection pattern for DOM, render, formatting, and autosave collaborators.
