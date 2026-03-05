# Code Role Notes

- Thinking level: low (validated direct defect line).
- Patch plan:
  - Change `publishedAt: publishedAt.toDate().toISOString()` to `publishedAt` in `js/db.js` `publishBracket`.
  - Add `tests/unit/bracket-publish-db-policy.test.js` asserting timestamp type consistency and no ISO conversion.
- Conflict resolution across roles:
  - Requirements + Architecture agree on Timestamp consistency.
  - QA requested explicit regression coverage; implemented via policy test.
