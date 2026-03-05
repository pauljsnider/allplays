# QA Role Notes

- Targeted regression to validate:
  - Old weekly series with small finite `count` and start date far before `windowStart` should produce zero occurrences once count is exhausted.
  - Active finite series should still produce expected in-window occurrences until count is reached.
  - Infinite/without-count recurrence should remain unchanged.
- Validation approach:
  - Run recurrence unit spec(s) under `tests/` related to `expandRecurrence`.
  - If no direct test runner target exists, run the nearest recurrence-related node test file and report outcome.
