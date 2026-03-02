# Code Role Notes

## Thinking Level
medium - isolated parser change with regression-test extension.

## Patch Plan
1. Update offset bound check in `js/utils.js` from `hours > 23` to `hours > 14`.
2. Add unit tests for `-9999` and `+2599` in `tests/unit/ics-timezone-parse.test.js`.
3. Execute targeted Vitest suite for ICS timezone parsing.
4. Commit and push to PR head branch.

## Fallback
If CI exposes compatibility regressions, narrow failure by replaying ICS fixtures and adjust validation messaging without loosening the range constraint.
