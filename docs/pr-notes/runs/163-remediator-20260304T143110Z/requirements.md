# Requirements role notes

- Objective: Resolve the three unresolved PR review threads on recurrence expansion in PR #163.
- Required outcomes:
  - Fix weekly cadence logic when the recurrence cursor is fast-forwarded to `windowStart`.
  - Ensure iteration guard cannot truncate day-by-day traversal for long-running series.
  - Strengthen tests to verify no missing weekly occurrences in the full visible window for long-running series.
- Scope constraints:
  - Minimal targeted edits only in recurrence expansion logic and affected unit tests.
  - No unrelated refactors or behavior changes outside recurrence expansion guardrails.
- Acceptance signals:
  - Updated unit test(s) fail before and pass after fix.
  - Existing recurrence-expand tests pass.
