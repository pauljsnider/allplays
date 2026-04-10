Objective: resolve the two unresolved review comments on PR #478 in the smallest possible change set.

Current state: the Playwright smoke test injects a `UTILS_STUB` string with over-escaped regex content in `extractOpponent` and `getCalendarEventStatus`.
Proposed state: keep test behavior the same while correcting JavaScript string escaping so the generated regexes match cancelled calendar content at runtime.

Risk surface: low and isolated to one smoke test stub. Blast radius is limited to test execution for cancelled imported calendar events.

Assumptions:
- The review comments correctly target only the stubbed helper implementations in this test file.
- No broader refactor is needed because production code is not part of the feedback.

Recommendation: change only the escaping inside the stub string and validate the affected spec path.
