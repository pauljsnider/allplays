# Architecture Role Summary

## Decision
Patch recurrence boundary normalization inside `expandRecurrence` in `js/utils.js`.

## Design
- Compute `isLocalMidnight` and `isUtcMidnight`.
- If local midnight: keep existing end-of-day expansion (`setHours(23,59,59,999)`).
- If UTC midnight but not local midnight: reconstruct boundary using UTC Y-M-D as a local date at `23:59:59.999`.

## Control Equivalence
- Read-only date math change.
- No changes to Firestore rules, auth flow, or tenant access boundaries.
- Blast radius constrained to recurrence cutoff calculation.
