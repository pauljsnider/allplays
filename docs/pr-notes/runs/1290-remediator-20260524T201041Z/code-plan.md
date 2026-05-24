# Code Plan

1. Inspect `dashboard.html` and the dashboard unit test coverage.
2. Keep `requireSyncedAuth()` as a one-shot promise wrapper around `checkAuth()`.
3. Make the synchronous-callback unsubscribe handling explicit and readable so the review concern is directly addressed.
4. Validate with the focused dashboard unit test.
