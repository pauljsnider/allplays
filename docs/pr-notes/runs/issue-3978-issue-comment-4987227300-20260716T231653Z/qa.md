# QA Review

## Risk Matrix

| Risk | Level | Guardrail |
|---|---|---|
| Cancelled game remains promoted as live | High | Filter direct and shared discovery records |
| Stale cancelled record starts viewer subscriptions | High | Initial-load viewer test |
| Open viewer remains active after cancellation | High | Transition and teardown test |
| Cancellation persists contradictory fields | High | Legacy and app payload tests |
| Shared fixture exposes duplicate empty stream | Medium | Mirror helper tests |
| Browser serves stale nested module | Medium | Cache-key assertion |

## Automated Tests To Add/Update

- Verify both cancellation implementations write terminal live state.
- Verify direct/shared cancelled records are not returned as live.
- Verify initial stale-live cancellation starts no engagement subscriptions.
- Verify live-to-cancelled transition clears flags and calls unsubscribe handlers.
- Verify shared cancellation propagates while active live status does not.
- Verify entry and nested-module cache keys.

## Manual Test Plan

1. Cancel an active game from legacy schedule and confirm homepage/viewer shutdown.
2. Repeat from the React app and confirm the same persisted fields.
3. Keep a parent viewer open during cancellation and confirm shutdown without refresh.
4. Repeat with a linked opponent and confirm neither side is promoted live.

## Negative Tests

- Preserve valid live, completed, replay, and non-cancelled same-day chat behavior.
- Reject both cancellation spellings.
- Do not mirror active live state to a counterpart without its event stream.
- Preserve tenant isolation and existing cancellation authorization.

## Release Gates

- Focused Vitest regression set.
- Root unit suite, app lint/typecheck/tests/build, bundle-size check.
- Android Gradle unit tests and debug assembly.
- Preview smoke and CI checks; Linux does not provide local iOS validation.

## Post-Deploy Checks

- Target zero cancelled games in live discovery.
- Target zero engagement writes after `cancelledAt` from supported clients.
- Target zero shared counterpart cancellation divergence.
- Confirm no affected-page runtime or module-cache errors.
