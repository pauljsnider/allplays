# Requirements Role Notes (fallback, no sessions_spawn available)

## Objective
Enforce soft-delete policy so inactive players are excluded from active workflows but remain visible in historical/reporting views.

## Decisions
- Keep active-only default for `getPlayers(teamId)` and active workflows.
- Historical/reporting pages must call `getPlayers(teamId, { includeInactive: true })`.
- `deletePlayer` must be soft-delete only (same semantics as deactivate).
- Roster management copy must explicitly clarify delete semantics.

## Success Criteria
- Deactivated player is absent from active roster flows.
- Historical pages still resolve deactivated player identities.
- Deep-link `player.html` for inactive player resolves.
- No hard-delete call in `deletePlayer` path.
