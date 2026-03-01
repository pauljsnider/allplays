# Code Role Summary

## Patch Scope
- `js/auth.js`
- `tests/unit/auth-google-parent-invite-cleanup.test.js`

## Planned Changes
1. Introduce shared helpers for pending-activation cleanup and failed Google-signup cleanup.
2. Ensure failure branches in Google new-user setup clear pending activation code before throwing.
3. Keep fail-closed behavior by rethrowing parent-invite errors after cleanup.
4. Add redirect regression and delete-failure regression tests.

## Conflict Resolution
- No role conflicts on desired behavior.
- Execution note: requested `allplays-*` skills/sessions spawning tooling unavailable in this environment; applied manual four-role synthesis and persisted artifacts for traceability.
