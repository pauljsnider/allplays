Implementation plan:
1. Update `slugifyStatId()` to retain underscores while still removing unsupported characters.
2. Replace `evaluateDerivedFormula()`'s `new Function()` path with tokenization + recursive-descent parsing over the allowed arithmetic subset.
3. Extend `tests/unit/stat-leaderboards.test.js` with underscore-key and safe-evaluation regressions.
4. Run the focused unit test file, inspect the diff, then stage and commit only the scoped changes.
