# Requirements Role (manual fallback)

Required allplays orchestration skills/subagent tooling were requested but are unavailable in this runtime, so this is a manual role synthesis artifact.

## Objective
Ensure parent-dashboard RSVP writes are scoped to the selected child/event context for multi-child families.

## User-facing requirement
When a parent has selected one child in the filter and submits RSVP from schedule/day modal, only that child's playerId must be persisted.

## Acceptance criteria
- RSVP payload never includes sibling playerIds when child filter context exists.
- Existing behavior for no selected-child context remains unchanged.
- Regression test covers selected-child precedence over broad childIds payload.

## Risk surface
- Parent-dashboard availability submission path only.
- Potential blast radius is RSVP payload composition for games/practices.
