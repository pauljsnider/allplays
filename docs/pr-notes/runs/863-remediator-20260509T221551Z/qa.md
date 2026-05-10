# QA Notes

- Validate by direct source inspection because the repo has no automated test runner.
- Edge cases: `undefined`, `null`, empty string, mixed-case excluded statuses, numeric truthy values, object values.
- Expected: excluded strings return true; all non-string values return false without throwing.
