# QA role synthesis (fallback single-agent)

Requested subagent skill `allplays-qa-expert` was not available in local skills list.

## Test strategy
- Add unit tests for pending-admin-invite processing:
  - processes all pending emails after team creation
  - attempts invite email send for new users only
  - reports fallback-needed results when email send fails
  - no-op when no pending invites
- Run targeted Vitest suite for the new helper file.

## Regression checks
- Existing-team invite path should still call invite APIs immediately from `Send Invite`.
- New-team flow should continue saving team and then redirecting to dashboard.
