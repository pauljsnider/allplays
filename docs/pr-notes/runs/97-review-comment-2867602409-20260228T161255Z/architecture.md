# Architecture Role Notes

## Current State
`deriveResumeClockState()` resolves mixed datasets by comparing latest timestamped against furthest untimestamped progression.

## Proposed State
For mixed datasets:
- Compute latest timestamped candidate.
- If untimestamped candidates appear after it in observed event order, choose the latest such untimestamped candidate.
- Otherwise keep existing progression comparison fallback.

## Risk and Blast Radius
- Scope limited to tracker resume helper and import cache-bust version.
- No Firestore schema/rules changes.
- Minimal runtime risk due isolated pure-function update and added unit coverage.
