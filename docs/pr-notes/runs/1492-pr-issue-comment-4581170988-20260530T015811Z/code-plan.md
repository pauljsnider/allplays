# Code Plan

## Patch Scope
- Import `doc` and `getDoc` in `apps/app/src/lib/searchService.ts`.
- Replace inline parent-home fallback merge with `mergeParentHomeSearchTeams()`.
- Add `buildParentHomeSearchTeam()` to merge parent-home display fields over canonical team visibility fields.
- Update app-search unit mocks and tests for direct team document reads.

## Implementation Notes
- Existing site-list teams are merged without an extra document read.
- Fallback-only parent-home teams require a canonical team doc read.
- Missing, failed, inactive, or archived canonical docs are skipped.
