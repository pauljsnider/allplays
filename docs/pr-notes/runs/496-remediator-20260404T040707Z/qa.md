Targeted validation:
- Confirm `mergeCalendarImportEvents` skips `dbEvents` entries with empty or missing `date`.
- Confirm valid date conflicts within 60 seconds still return `hasConflict = true`.
- Confirm imported events continue rendering when malformed legacy records are present.

Manual test path:
- Use `test-pr-changes.html` or a small console invocation after serving the repo locally.

Residual risk:
- No automated test runner exists in this repo, so validation is manual/targeted only.
