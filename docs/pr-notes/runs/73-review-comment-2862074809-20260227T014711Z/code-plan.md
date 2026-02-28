# Code Role Plan

## Tooling Constraint
Requested orchestration skills/subagents (`allplays-orchestrator-playbook`, role expert skills, `sessions_spawn`) are unavailable in this runtime; role outputs are captured directly in run artifacts.

## Patch Scope
- File: `js/auth.js`
- Function: `handleGoogleRedirectResult`
- Change: wrap `processGoogleAuthResult(result)` in `try/finally` and clear `pendingActivationCode` in `finally` when a redirect result exists.

## Safety
Minimal change, no API/signature change, no cross-module side effects.
