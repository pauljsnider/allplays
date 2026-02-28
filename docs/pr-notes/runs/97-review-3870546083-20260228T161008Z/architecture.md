# Architecture Role Summary

## Decision
Use a deterministic dual-strategy chooser:
- `latestByTimestamp`: newest record among timestamped candidates.
- `mostAdvanced`: furthest game progression among all valid candidates.

Select the later state by progression comparator (period order, then clock, then source order).

## Why
Pending server timestamps are common in Firestore local/offline scenarios. Treating missing timestamps as ineligible can restore stale state. Comparing both candidates keeps correctness in mixed datasets while preserving timestamp authority when it still reflects the latest state.

## Controls Equivalence
- No persistence-layer change.
- No auth/rules impact.
- No additional network calls.
- Blast radius limited to pure function behavior.
