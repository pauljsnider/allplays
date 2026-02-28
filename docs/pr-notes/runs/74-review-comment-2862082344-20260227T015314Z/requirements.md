# Requirements Role Summary

## Objective
Preserve historical and replay access for soft-deleted teams while keeping active workflows filtered.

## User Impact
- Parents/coaches can open old game reports even after team deactivation.
- Replay cards that intentionally include inactive teams keep working end-to-end.

## Acceptance Criteria
- `game.html` loads team header/details for inactive team documents.
- `live-game.html?replay=true` loads team metadata for inactive teams.
- Active discovery/list helpers remain unchanged (inactive excluded by default).

## Assumptions
- Team documents are soft-deleted (`active=false`) and not hard-deleted.
