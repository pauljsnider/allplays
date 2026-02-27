# Architecture Role Summary

## Current State
`getTeam(teamId)` defaults to active-only and returns `null` for inactive docs.

## Proposed State
Apply explicit `includeInactive` at history/replay route boundaries rather than changing the global default.

## Rationale
- Minimizes blast radius.
- Preserves active workflow filtering introduced for issue #65.
- Restores historical/report/replay read paths that rely on direct team lookup.

## Risk Surface
- Low risk: two call-site option changes.
- No security rule changes.
