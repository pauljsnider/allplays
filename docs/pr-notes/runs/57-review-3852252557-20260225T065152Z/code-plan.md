# Code Role (allplays-code-expert)

## Objective
Implement the smallest safe patch in `rainout-polling-runtime` that addresses Codex P1 findings.

## Implementation Summary
1. Add `DEFAULT_BOUNDARY_TOLERANCE_MS` and `isWithinPollBoundaryWindow()` to tolerate scheduler jitter.
2. Replace strict equality boundary gate with tolerance-window gating.
3. Reorder event processing so state persistence occurs after chat/in-app fanout succeeds.
4. Extend unit tests for tolerance-window behavior and fanout-failure state safety.

## Role Conflict Resolution
- Requirements favored reliability under jitter; Architecture favored minimum surface area. The chosen design adds only one helper and one config value in existing runtime module.
- QA required explicit negative/positive coverage; code changes include both without expanding into end-to-end harness complexity.

## Tradeoffs
- Small chance of duplicate processing inside tolerance window remains possible if scheduler invokes multiple times quickly; this is currently preferable to missing production runs and is bounded by idempotency checks.
