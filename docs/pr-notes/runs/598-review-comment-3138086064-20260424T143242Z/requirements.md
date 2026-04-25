# Requirements

## Objective
Ensure tournament pool advancement updates every downstream bracket slot that depends on the pool, even when the admin triggered advancement from a filtered schedule view such as `past-all`.

## Acceptance Criteria
1. Advancing a pool uses the full team tournament game list, not only currently rendered schedule rows.
2. Downstream bracket games outside the current UI filter still receive resolved slot updates.
3. Existing visible-row interactions keep working.
4. Unit validation remains green.

## Non-goals
- Changing bracket propagation rules.
- Refactoring schedule filters.
- Expanding tournament data model scope.

## Risks
- Mixing practice entries into the planner input would create noise, so the full cache must stay game-only.
- Visible-row handlers still rely on the rendered cache, so the new full cache must be additive rather than a replacement for all UI actions.

## Recommendation
Keep a dedicated full-team game cache populated during `loadSchedule()` and use that cache only for tournament planning/apply flows.