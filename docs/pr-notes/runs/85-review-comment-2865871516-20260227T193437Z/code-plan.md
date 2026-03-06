# Code Role Summary

## Patch scope
Single-file fix in `edit-team.html` admin invite click handler.

## Implementation
- Added `code` normalization (`trim`) after `inviteAdmin` result.
- Added code-presence guard in both existing-user and new-user branches.
- Routed missing-code cases to warning status and skipped `sendInviteEmail`.
- Preserved existing fallback behavior when email delivery fails but code exists.

## Notes
Environment did not expose `allplays-orchestrator-playbook` / role subagent skills or `sessions_spawn`; role outputs were produced in-run as equivalent planning artifacts for traceability.
