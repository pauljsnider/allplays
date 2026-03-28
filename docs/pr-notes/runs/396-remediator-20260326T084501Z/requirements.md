Objective: remediate the four unresolved PR #396 review findings in smoke test helpers/specs without changing product code.

Current state:
- `buildUrl` can drop a base path prefix when callers pass absolute paths.
- The reset-password smoke test installs the boot issue collector after navigation for login, but before routing for reset-password.
- The reset-password route mock intercepts the expected invalid-code request, but other `accounts:resetPassword` calls could continue to the live endpoint.
- `pageerror` ignore handling is already present in the helper and should remain intact.

Proposed state:
- Preserve any base pathname in smoke URLs.
- Register the Firebase route mock before creating listeners that can observe navigation failures.
- Fail closed for unexpected `accounts:resetPassword` requests in this smoke test.

Assumptions:
- Only the targeted smoke test file and helper need changes.
- The unresolved `pageerror` feedback refers to behavior already present in the current branch.
