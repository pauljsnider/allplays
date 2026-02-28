# Requirements Role (allplays-requirements-expert)

## Objective
Keep scheduled rainout polling reliable under normal scheduler jitter and prevent missed parent/coach notifications when fanout has transient failures.

## Current vs Proposed
- Current: Polling only runs on exact interval millisecond boundaries; real cron jitter causes repeated `not_on_boundary` skips.
- Proposed: Accept runs that occur shortly after a boundary within a bounded tolerance window.
- Current: Runtime writes changed rainout state before chat/in-app fanout; fanout failure can suppress future notifications.
- Proposed: Persist state only after fanout succeeds so failed fanout retries remain eligible.

## Risk Surface and Blast Radius
- Surface: `executeRainoutPollingRun` scheduling gate and per-event write/fanout order.
- Blast radius (current): Production polling can stall; subscribers can miss change notifications.
- Blast radius (proposed): Localized runtime logic change, no Firebase rules or tenant auth changes.

## Assumptions
- Runtime executes on a schedule where invocation drift is usually seconds, not many minutes.
- Duplicate sends are preferable to silent missed alerts; idempotency still guards repeat processing for identical updates.

## Recommendation
Adopt bounded boundary tolerance plus fanout-before-state ordering, then protect both behaviors with unit tests.

## Success Criteria
- Polling runs when invocation is slightly late relative to boundary.
- Polling still skips clearly off-boundary invocations.
- State is not advanced when fanout fails, allowing retry on next run.
