# Requirements Role Summary

## Objective
Fix timestamp consistency in rainout runtime so one execution uses one time reference (`nowMs`) for deterministic behavior.

## User/Operator Impact
- Improves audit consistency within a single run.
- Keeps deterministic tests stable for coaches/parents/managers relying on reliable notification timing records.

## Acceptance Criteria
- `targetStartedAt` derives from `nowMs`.
- Success and error audit `durationMs` are computed from `nowMs` and `targetStartedAt`.
- Existing unit tests for rainout runtime pass.
