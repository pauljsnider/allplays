Implementation plan:
1. Read `undoLogEntry` and the live event broadcast helper.
2. Compute an effective applied delta from `currentVal` and `newVal`.
3. Use that delta for score rollback and reversed stat broadcasting.
4. Run a targeted diff/status review, then commit only the scoped changes.
