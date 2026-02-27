# Code Role Plan

## Thinking Level
- Level: low
- Reason: targeted bug fix with clear failing behavior and existing unit test harness.

## Patch Scope
1. Add `updateTeam` dependency in `js/accept-invite-flow.js` and persist updated `adminEmails` after de-dup check.
2. Thread `updateTeam` into dependency injection in `accept-invite.html`.
3. Update `tests/unit/accept-invite-flow.test.js` to assert persistence and duplicate guard.

## Smallest Next Experiment
Run focused invite-flow unit test.

## Fallback Path
If focused test fails unexpectedly, run full unit suite and isolate unrelated failures from baseline.
