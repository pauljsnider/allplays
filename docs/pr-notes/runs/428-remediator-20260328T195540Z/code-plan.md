# Code plan

Thinking level: medium

1. Refactor the `live-tracker` source rewrite helper to replace imports by regex against specifiers instead of exact versioned lines.
2. Introduce a tiny queued timeout scheduler in the test harness so callbacks run asynchronously and can be flushed deterministically by the test.
3. Update the delete interaction test to flush queued timers before asserting persisted writes.
4. Run the targeted Vitest file and verify only the intended test harness file and run notes changed.
5. Commit the scoped fix on the current branch without pushing.
