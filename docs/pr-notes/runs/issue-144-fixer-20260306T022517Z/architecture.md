# Architecture role (fallback synthesis)

## Current state
- `submitRsvp` writes aggregate parent RSVP doc keyed by `userId` with `playerIds[]`.
- `submitRsvpForPlayer` writes per-player override doc keyed by `userId__playerId`.
- Effective summary computation de-duplicates at player level via `computeEffectiveRsvpSummary`.
- Override submit path currently deletes the legacy `userId` RSVP doc unconditionally.

## Risk surface
- Unconditional delete can remove sibling player statuses that still belong in summary.
- Blast radius: RSVP summaries on calendar, parent dashboard, and game-day views.

## Proposed state
- Keep current summary de-duplication logic.
- Narrow legacy cleanup in `submitRsvpForPlayer` to delete only true single-player legacy docs targeting the overridden player.
- Preserve multi-player parent docs so sibling statuses remain intact.

## Tradeoffs
- Adds one read (`getDoc`) before optional cleanup delete.
- Slightly higher write-path latency, but safer correctness semantics.

## Control equivalence
- Access control unchanged.
- Data consistency improves with lower risk of status loss.
