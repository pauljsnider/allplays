# QA Role Summary

## Regression Focus
- Ensure only runtime options changed; request handling and payload logic untouched.
- Verify function file still parses and exports properly.

## Checks
- Static search for hardcoded service account pattern in `functions/index.js`.
- Syntax validation via Node parse check.
- Git diff scope review to confirm single-file functional change.

## Acceptance Criteria
- `runWith()` no longer contains literal service account email.
- Function remains syntactically valid and callable.
