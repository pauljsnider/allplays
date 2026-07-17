# Code Review And Execution Plan

## Patch Plan

- Retain the existing minimal fix across cancellation writes, discovery, viewer teardown, engagement gating, shared scheduling, and cache-busted entry points.
- Add the missing version key to the changed nested shared-schedule module.
- Add run-scoped role artifacts and validate the complete branch.

## Code Changes Applied

- Legacy and app cancellation paths persist terminal live state.
- Live discovery filters cancelled direct and shared records.
- Initial and active viewers reject cancellation and stop engagement.
- Shared fixtures mirror cancellation but not active live state.
- `js/db.js` imports `shared-schedule-sync.js?v=2` with regression coverage.

## Validation Run

- Focused Vitest: 6 files, 36 tests passed.
- Root Vitest: 623 files and 4,270 tests passed; 3 files and 53 tests skipped.
- App lint and typecheck: passed with existing warnings only.
- App Vitest: 131 files and 1,299 tests passed.
- App production build, visualizer verification, and bundle-size guard: passed.
- Capacitor sync: passed.
- Android `./gradlew test`: passed after setting the installed SDK path.
- Android `./gradlew assembleDebug`: passed after setting the installed SDK path.
- Local iOS validation was not attempted on Linux; the existing PR macOS simulator CI check passed on the prior head.

## Residual Risks

- Native REST fallback counterpart parity is outside this issue's minimal scope.
- Server-enforced post-cancellation chat/reaction denial requires a separate Firestore rules decision.

## Commit Message Draft

`Finalize cancelled live-game safeguards`

## Synthesis

### Acceptance Criteria

Cancellation is terminal at write, discovery, viewer, engagement, and shared-schedule boundaries, including stale records and already-open viewers.

### Architecture Decisions

Use layered write/read defenses, keep cancellation terminal, avoid active-stream mirroring, and version changed browser module edges.

### QA Plan

Run focused and full unit coverage, app quality/build checks, Android Gradle checks, and verify current PR CI.

### Implementation Plan

Complete the nested cache key, preserve the reviewed patch, validate, commit, push to PR #3984, and update its body/evidence.

### Risks And Rollback

The change is client-only and reversible by reverting the PR commits. No migration or permission change is included. Defensive filters limit the blast radius of inconsistent historical records.
