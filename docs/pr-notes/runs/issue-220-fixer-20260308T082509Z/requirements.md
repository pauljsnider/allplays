# Requirements Role (fallback synthesis)

## Objective
Surface organization or tournament owned head-to-head games as a single shared record that appears on both participating teams.

## Current vs Proposed
- Current: team schedule pages only read `teams/{teamId}/games`, so centrally owned matchups cannot appear unless duplicated per team.
- Proposed: centrally stored shared games are projected into team schedules and resolved through the shared record for reads and updates.

## Acceptance Criteria
1. A shared game with `homeTeamId` and `awayTeamId` can be projected into either team's schedule.
2. Placeholder opponents remain visible with `TBD` style naming until a real team is assigned.
3. Team-owned games continue to behave exactly as before.

## Risks
- Shared-game IDs must not collide with local team game IDs in page URLs.
- Existing pages call generic game helpers broadly, so shared handling must be transparent after projection.
