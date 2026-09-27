# Architecture

## Current State

`loadAppSearchTeams` calls `loadParentHomeSummary`, which calls `loadParentScheduleSummary` and then `loadParentSchedule`. The schedule loader maps every authorized team through `buildTeamSchedule`, reading games and practices that search discards.

## Decision

Add a dedicated Home service projection backed only by `loadParentScheduleScope`. It returns the existing `ParentHomeModel` team shape with `events: []`, parent children, and staff-team summaries. Search swaps to this dependency while retaining its current merge, metadata fallback, access filters, cache, direct-admin discovery, and stream-volunteer discovery.

The existing `loadParentTeamsSummary` was rejected for this use because it also loads chat. A dedicated loader makes the no-schedule/no-unrelated-data boundary explicit and testable.

## Files

- `apps/app/src/lib/homeService.ts`: scope-only search team projection.
- `apps/app/src/lib/searchService.ts`: dependency substitution only.
- Focused service tests and run artifacts.

## Security And State

Authorization continues to derive from validated parent links and the existing authoritative staff discovery. Visibility fallback and inactive/private filtering remain in search. No rules, indexes, persisted schema, or native behavior changes.

## Failure Modes

- Missing visibility metadata: retain the bounded team-document fallback.
- Zero-event staff teams: map `scope.staffTeams` directly into the Home team model.
- Future schedule coupling: regression asserts the lightweight loader never invokes `loadParentSchedule`.

## Rollback

Revert the import/call substitution and loader export. No data migration is required.
