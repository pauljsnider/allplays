# Code Role

## Implementation Plan
1. Add `escapeHtml(value)` to `EDIT_TEAM_UTILS_STUB` in `tests/smoke/admin-invite-redemption.spec.js`.
2. Preserve the existing DB wildcard route and rollover stub exports from the prior commit.
3. Commit and push the test-only fix to `paulbot/fix/issue-642-20260427162022`.

## Expected Outcome
The edit-team page module evaluates in preview smoke, admin invite click handlers bind, and the existing-user admin fallback assertions can observe the status/code/list updates.
