# Architecture Role Summary

Thinking level: medium (single-page tracker state consistency + Firestore document invariants).

## Current state
Resume gating checks doc-level and collection-level signals. Reset/cancel cleanup paths were not fully consistent across tracker implementations.

## Proposed state
Standardize cleanup contract for fresh-start flows:
- Delete all event collections contributing to resume inference.
- Set game doc flags/status to scheduled baseline (`liveHasData: false`, `liveStatus: 'scheduled'`).
- Keep opponent identity linkage fields intact.
- Mirror the same values into in-memory `currentGame` after successful update.

## Risk surface / blast radius
- Scope limited to tracker reset/start-fresh/cancel branches.
- No auth/rules schema changes.
- Potential risk is over-clearing game metadata; mitigated by preserving opponent identity fields explicitly.
