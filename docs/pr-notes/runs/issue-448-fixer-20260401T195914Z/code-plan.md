## Thinking Level

medium: the code change is small, but the issue requires reconciling current implementation against reported behavior and choosing the narrowest regression guard that still proves the control.

## Constraints

- The requested orchestration skills and `sessions_spawn` are not available in this environment.
- Only the main session can edit files and commit.
- Keep the patch targeted to issue #448.

## Plan

1. Persist role-equivalent notes for requirements, architecture, QA, and code planning.
2. Add failing unit tests for dashboard redemption wiring and the DB expiry guard.
3. Update `parent-dashboard.html` to validate the code before redemption.
4. Run the targeted Vitest files and then the unit suite.
5. Commit the fix and tests with an issue-linked message.
