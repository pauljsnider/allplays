# Architecture

## Current State
- Reviewed commit `9fa2897` added Team ID workflow and create-team navigation that Codex flagged for a full reload concern.
- Current branch head `1e2ef17` already changes post-create navigation to `edit-team.html?teamId=...`, which forces a clean page bootstrap from URL state.
- The unit test harness for `edit-team.html` predated the Team ID panel and omitted those DOM nodes.

## Decision
- Keep the production redirect fix already present on the branch.
- Patch only the test harness so it matches the current edit-team DOM surface.

## Why
- This is the smallest change that preserves behavior and closes the review gap with low blast radius.
- Static HTML plus module initialization depends on DOM contract correctness. Test harness parity is the right regression guard.

## Risks
- Low risk. Change is limited to test scaffolding.
- No Firebase, auth, or data-model behavior changes.

## Rollback
- Revert the single test-harness commit if unexpected issues appear.

## Orchestration Note
- Required subagent spawn was attempted from the main run, but the local gateway timed out before child sessions became usable. This artifact records the architecture decision for traceability.
