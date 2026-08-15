# Code Plan And Orchestrator Synthesis

## Acceptance Criteria

Expose existing sanitized standings and final results on the public route, preserve anonymous public-data boundaries, highlight the current team, contain the table on mobile, bound recent results to five, and provide honest empty/error/league-link states.

## Architecture Decisions

- Keep profile and results loads separate.
- Use only direct public callable adapters.
- Request one explicit bounded projection page and reject truncation rather than compute partial standings.
- Reuse the native standings engine through a small adapter.
- Treat server filtering as authoritative and add client filtering as defense in depth.

## QA Plan

Write service and component regressions first, extend the existing public-team mobile smoke module stub and flow, then run the focused app/service/native/API/smoke/typecheck commands.

## Implementation Plan

1. Add failing service tests for metadata, filtering, ranking inputs, ordering, and bounds.
2. Add failing component tests for table, highlight, results, empty/error states, and safe link.
3. Extend the callable and standings adapters.
4. Implement normalized public results in `publicTeamsService`.
5. Render the public Results and Standings section.
6. Update the existing mobile smoke stub and assertions.
7. Run focused validation and commit all artifacts, tests, and implementation together.

## Risks And Rollback

The main risks are partial projections being presented as authoritative, inconsistent mirrored games affecting records, accidental private-data model expansion, duplicate-name identity loss, and page-level mobile overflow. The implementation fails closed on truncation, excludes disputed mirrored results, preserves team IDs, maps only required fields, and contains table overflow. Rollback is a single commit revert because the change is read-only and has no schema impact.

## Root Cause

The modern typed public-team boundary intentionally narrowed the already-sanitized server profile to identity/location and never exposed the existing public-games callable. The route therefore could not reach safe standings inputs or final results even though both backend capabilities already existed.

## Prevention / Learning

When creating a modern typed boundary over an existing public projection, inventory all allow-listed fields and read-only projections required by replacement routes. Preserve the server authorization boundary, expose only the minimum typed slice, and add contract tests proving both retained public fields and omitted private fields.

## Conflict Resolution

- Chose independent profile/results loading over a combined page failure so auxiliary outages do not hide public identity.
- Chose one bounded 500-item request with truncation rejection over cursor iteration to eliminate anonymous unbounded loops.
- Chose recent-results display even when standings are disabled because the issue independently requires both results and standings.
- Chose non-record finals in recent results but not standings because `countsTowardSeasonRecord` explicitly separates those semantics.
