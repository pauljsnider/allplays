## Architecture role summary

- Current state: `firebase.json` serves JS with hour-long caching, so HTML and module asset versions can drift after deploy.
- Proposed state: use a new immutable query token for every page consuming the newly exported tracking helpers, aligning on `utils.js?v=10`.
- Why this path: bumping only the import sites preserves behavior and minimizes blast radius; changing hosting cache headers or global token strategy is broader than this review requires.
- Rollback: revert the import-token-only patch if it causes unexpected load issues.
