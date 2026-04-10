## Architecture Role Summary

- Smallest viable change: localize the fix to `tests/unit/live-tracker-opponent-stats.test.js`.
- Implementation direction: replace per-import exact rewrites for app-local modules with a helper that removes any named import from the target module path, regardless of cache-buster suffix.
- Blast radius: one unit-test harness. No shipped JS bundles or Firebase interactions change.
- Controls: keep the existing explicit dependency injection surface (`deps.db`, `deps.firebase`, `deps.utils`, `deps.auth`) so the test still fails loudly if the target modules disappear entirely.
- Rollback: revert this single test-file change if it causes unexpected harness regressions.
