# QA

## Risk Assessment
- Primary risk: cross-team notification leak when editing an unlinked or relinked opponent.
- Secondary risk: missing counterpart notification for legitimately linked games.

## Test Matrix
- Edit linked game, clear linked opponent, save with notifications enabled: only current team should be notified.
- Edit linked game, switch to a new linked opponent, save with notifications enabled: notify current team and new counterpart only.
- Edit linked game without changing link: counterpart notification still targets the linked opponent.

## Regression Guardrails
- Keep assertions focused on submitted link state in the save flow.
- Preserve existing notification helper wiring test coverage.

## Exit Criteria
- Targeted unit tests pass.
- No stale-cache fallback remains in counterpart notification targeting.
