# Requirements Role Synthesis

## Objective
Implement team soft-delete so inactive teams are hidden from active workflows and discovery while preserving historical game/replay access.

## Decisions
- Team delete UX becomes archive semantics: set `active=false` without deleting team subcollections.
- Active workflows and discovery default to active-only teams.
- Historical replays remain visible on home replay cards even when team is inactive.

## UX Notes
- Owner/admin delete actions should remain available but represent deactivation.
- Active schedule and management entry points should not list inactive teams through team list/access helpers.
- Parent future schedule views should exclude inactive teams.
