# Requirements

## Problem Statement

Global search currently waits for a Home schedule projection that loads games and practices for every authorized team even though search only needs team access. Multi-team parents, coaches, admins, and scorekeepers therefore pay event-cardinality cost before team and player results settle.

## Acceptance Criteria

1. Cold search team hydration performs no game, practice-session, or schedule-event list reads.
2. Active parent-linked, staff-managed, directly administered, and selected stream-volunteer teams remain discoverable.
3. Inactive and archived teams remain excluded, and private/public visibility rules remain unchanged.
4. Existing per-user cache reuse and in-flight coalescing remain intact.
5. Public team results remain capped at 20 and player queries remain within `playerSearchFirestoreQueryBudget`.
6. Known teams still render immediately; hydration failure and stale async results remain safely handled by the existing dialog flow.

## Non-Goals

- Player indexing, ranking, or query-budget changes.
- Schedule or Home event-loading changes.
- Global search UI redesign.

## Edge Cases

- Staff team with no players, events, or chat.
- Missing visibility metadata requiring the existing per-team fallback.
- Duplicate access through multiple roles.
- Partial or failed access discovery must remain retryable rather than establish authoritative absence.

## Open Questions

None blocking. Preserve existing behavior outside the search-to-schedule dependency.
