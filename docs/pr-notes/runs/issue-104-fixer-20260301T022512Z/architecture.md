# Architecture Role - Issue #104

## Root Cause
Client-side scope calculation in `parent-dashboard.html` incorrectly performs:
- filter by `teamId`
- collect every child ID across team events
This over-collects IDs before calling `submitRsvp`.

## Minimal Safe Design
Introduce a small pure helper module to resolve RSVP `playerIds` from event scope:
1. If explicit `childId` provided by clicked row, return `[childId]`.
2. Else if explicit `childIds` provided (aggregate row), return normalized unique subset.
3. Else fallback to IDs from events matching `(teamId, gameId)` only.

## Why This Design
- Keeps behavior deterministic and testable outside inline HTML script.
- Limits code movement and avoids broad refactor.
- Preserves compatibility with both list rows and calendar/day aggregate rows.

## Control Equivalence
- Data written to Firestore remains same shape.
- Access control unchanged.
- Blast radius reduced by narrowing payload generation scope.

## Rollback Plan
Revert helper import and button dataset additions; old behavior restored.

## Instrumentation
- Unit test asserts no team-wide leakage.
- Manual verification on parent dashboard with 2 siblings same team.
