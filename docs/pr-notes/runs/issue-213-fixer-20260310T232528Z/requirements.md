Objective: close the most shippable slice of issue #213 by making linked head-to-head tournament fixtures stay synchronized across both teams.

Current state:
- The repo already supports linked opponent teams and mirrored game creation under each team's `games` collection.
- Tournament scheduling exists on team schedules via `competitionType: 'tournament'` and `game.tournament`.
- Mirrored linked games currently drop `tournament` metadata, so the opponent-side fixture loses bracket and slot context.

Proposed state:
- Mirrored linked games preserve tournament metadata needed for bracket-aware head-to-head scheduling.
- The mirrored payload remains isolated to schedule-safe fields and keeps existing team-local ownership and access controls.

Acceptance:
1. Creating or updating a linked tournament game mirrors the `tournament` object onto the opponent-side fixture.
2. Mirrored tournament metadata is cloned, not shared by reference.
3. Existing non-tournament shared schedule behavior remains unchanged.
