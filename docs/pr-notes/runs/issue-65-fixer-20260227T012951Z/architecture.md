# Architecture Role Synthesis

## Current State
`deleteTeam` performs hard delete of team doc and subcollections. Team reads return all docs with no active filter.

## Proposed State
- Add team active contract in db helpers:
  - reads treat `active !== false` as active (backfill-safe)
  - write path for delete becomes update-only soft delete
- Query helpers accept options object with `includeInactive` (default false).
- Discovery helpers for live/upcoming exclude inactive team docs.
- Replay helper keeps completed games for inactive teams (explicit policy choice).

## Risk / Blast Radius
- Low data-loss risk (removes destructive behavior).
- Moderate behavior change risk on pages that rely on unfiltered team lists.
- Historical access preserved by keeping replay discovery inclusive.

## Conflict Resolution
- Issue suggests `getTeam(..., { includeInactive=false })`; to preserve historical views, explicit includeInactive usage is applied in replay contexts while default filtering is used for active workflows.
