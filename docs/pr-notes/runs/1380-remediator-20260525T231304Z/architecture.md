# Architecture

Decisions:
- Keep the test harness approach, but match the `schedule-print` import with a version-tolerant regular expression. This avoids coupling the test to cache-busting query strings.
- Replace UTC ISO date slicing with local date component formatting in `js/schedule-print.js`. This preserves existing option shape while fixing timezone drift.

Risks and rollback:
- Low risk. The API remains `YYYY-MM-DD` strings. Rollback is reverting this single commit.
