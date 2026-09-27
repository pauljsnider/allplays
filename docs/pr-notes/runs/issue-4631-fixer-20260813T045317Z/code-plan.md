# Code Plan

## Root Cause

Search reused a presentation-oriented Home schedule summary as an access-scope loader. That dependency called `loadParentSchedule`, which built every team's schedule before returning team summaries.

## Implementation Plan

1. Add `loadParentSearchTeamsSummary` in `homeService.ts`, backed only by `loadParentScheduleScope` and `buildParentHomeModel` with no events.
2. Replace the `loadParentHomeSummary` import and call in `loadAppSearchTeams`.
3. Update search-service mocks and add a multi-team regression that fails before the substitution.
4. Add Home service coverage asserting parent/staff results and no schedule loader invocation.
5. Run only the two nearest focused suites, stage all changed files, and commit once with issue reference.

## Prevention / Learning

Access discovery must depend on an access projection, never a schedule or presentation loader. Tests should assert the forbidden downstream loader is not reached, not merely that the final team list is correct.

## Recurrence Risk

Low after the dependency boundary is named and directly regression-tested. The remaining risk is future reuse of a full presentation loader in another scope-only workflow.

## Commit Draft

`Avoid schedule hydration in app search (#4631)`
