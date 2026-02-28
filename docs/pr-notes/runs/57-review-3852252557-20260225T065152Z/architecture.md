# Architecture Role (allplays-architecture-expert)

## Objective
Deliver minimal runtime changes that improve reliability while preserving tenant isolation and existing controls.

## Current vs Proposed Architecture
- Scheduling gate:
  - Current: `nowMs === getNextPollTimeMs(nowMs, intervalMinutes)`.
  - Proposed: modulo-based boundary-window check with configurable `boundaryToleranceMs` default.
- Event commit flow:
  - Current: `writeRainoutState` before `postChatUpdate`/`upsertInAppStatus`.
  - Proposed: fanout first, then `writeRainoutState`, then idempotency mark.

## Controls Equivalence/Improvement
- Access control and tenant segregation are unchanged.
- Auditability remains via `writeAuditLog` for both success/error paths.
- Reliability improves by reducing missed runs and preventing state advancement on fanout failure.

## Blast Radius
- Constrained to one runtime module and one unit test file.
- No schema/rules/index changes.

## Rollback Plan
Revert the single runtime commit if regressions occur; behavior returns to strict-boundary + pre-fanout-state semantics.
