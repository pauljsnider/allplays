# Architecture role (fallback inline)

## Current state
- `publishBracket` writes Firestore `Timestamp` fields and builds published view from in-memory bracket object.
- `getBrackets` always fetches full collection then filters in memory when `onlyPublished`.
- `autoAdvanceByes` auto-completes any one-sided game regardless of whether missing slot should be supplied by an upstream winner.

## Proposed state
- `publishBracket` continues using a single `Timestamp` instance and explicitly reuses it for view and write payload.
- `getBrackets` uses constrained Firestore query for `onlyPublished` (`where` + `orderBy`) with fallback preserving behavior.
- `autoAdvanceByes` only auto-completes one-sided games when the empty slot is a true BYE source (seed slot), not unresolved winner source.

## Blast radius
- Limited to bracket module and db bracket query/publish functions.
- No schema change, no rule change, no UI contract expansion.
