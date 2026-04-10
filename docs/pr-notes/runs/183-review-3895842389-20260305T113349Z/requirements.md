# Requirements Role Notes

- Thinking level: medium (single-function logic defect with downstream client impact).
- User-facing requirement: Publishing a bracket must return the same `publishedAt` data type that is persisted in Firestore to avoid client runtime type errors.
- Constraint: Keep behavior unchanged except timestamp type consistency.
- Acceptance criteria:
  - `publishBracket` in `js/db.js` uses one `Timestamp.now()` value for both DB write and returned object.
  - No `toISOString()` conversion in the return payload for `publishedAt`.
  - Regression guard exists in unit tests.
