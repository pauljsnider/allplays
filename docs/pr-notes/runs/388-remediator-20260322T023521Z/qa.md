QA focus

- Verify full success still clears the uploaded image and pasted text.
- Verify partial failure preserves the uploaded image preview and text area contents after the alert.
- Verify the apply button state still resets in `finally`.

Validation plan:
- Static review of the updated success-path condition.
- `git diff --check` to catch patch hygiene issues.

Known gap:
- Repo has no automated test runner for this page, so browser validation is not executed in this remediation run.
