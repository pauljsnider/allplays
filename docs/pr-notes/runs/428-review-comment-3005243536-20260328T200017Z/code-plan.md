## Code Role Summary

- File to change: `tests/unit/live-tracker-opponent-stats.test.js`
- Steps:
  1. Add a `rewriteModuleImports` helper that strips named imports by module path with optional cache-buster support.
  2. Use that helper for `db`, `firebase`, `utils`, and `auth` rewrites.
  3. Add a regression test that mutates `?v=` values and verifies the harness still rewrites the source.
- Explicit non-goals:
  - No changes to `js/live-tracker.js`
  - No changes to runtime cache-busting strategy
