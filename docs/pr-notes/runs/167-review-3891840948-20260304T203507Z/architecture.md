# Architecture Role Notes

## Current state
`ensureParentTeamAccess` catches and logs failures globally, which can allow downstream writes to execute despite a failed precondition.

## Proposed state
Add optional strict behavior to `ensureParentTeamAccess`:
- Default: log-and-continue (backward compatible).
- Strict mode: rethrow after logging.

Invoke strict mode only in rideshare offer submission to enforce precondition.

## Tradeoff
- Minimal patch and low blast radius.
- No cross-module API changes required.
