# Requirements role notes

## Objective
Resolve unresolved PR #148 review feedback on cancelled ICS event detection and matching test coverage.

## Required changes
- Thread `PRRT_kwDOQe-T585x5yAj`:
  - Make summary cancel marker check case-insensitive.
  - Maintain status check as case-insensitive (`ev.status?.toUpperCase() === 'CANCELLED'`).
- Thread `PRRT_kwDOQe-T585x5yAq`:
  - Update unit-test regex to match the corrected case-insensitive implementation for both `ev.status` and `ev.summary`.
- Thread `PRRT_kwDOQe-T585x5yfM`:
  - Ensure TeamSnap marker is matched only as a summary prefix (after optional trim), not as anywhere substring.

## Non-goals
- No refactor outside the ICS mapping cancellation logic.
- No unrelated UI or data-model changes.
