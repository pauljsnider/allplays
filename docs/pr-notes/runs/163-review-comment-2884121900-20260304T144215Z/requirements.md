# Problem Statement
The current long-running weekly recurrence test confirms a few future dates but does not prove there are no missing occurrences within the full visible window (`windowStart` to `windowEnd`) for a series that began on 2024-01-01.

# User Segments Impacted
- Coach: needs reliable recurring practice/game visibility without silent gaps.
- Parent: expects predictable calendar continuity and trust in schedule completeness.
- Team admin/program manager: relies on recurrence expansion integrity when series run for years.

# Acceptance Criteria
1. For a weekly Monday series started on 2024-01-01 and evaluated at fixed time `2026-03-01T12:00:00Z` with `windowDays=30`, the test validates the exact number of occurrences returned from computed `windowStart` to `windowEnd`.
2. The test validates cadence continuity by asserting each adjacent returned occurrence is exactly 7 days apart.
3. The test validates boundary correctness by asserting first and last returned occurrence dates match the expected in-window Mondays.
4. The test fails if any in-window occurrence is skipped due to iteration/fast-forward behavior.

# Non-Goals
- Changing recurrence runtime behavior in `js/utils.js`.
- Extending coverage to monthly/custom rules in this comment response.

# Edge Cases
- `windowStart` may begin mid-week and not on series weekday.
- Long-running series start far before visible window.
- Time-of-day from series start must not shift date-key matching.

# Open Questions
- None for this review comment scope.
