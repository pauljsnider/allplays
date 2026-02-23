# Architecture Role Notes

## Decision
Adopt bounded parsing phases:
1. Collect complete table blocks via `indexOf` scans.
2. Select candidate table by `id*=standingsGrid` or required headers.
3. Reuse existing row/cell extraction.

## Controls Equivalence
- Security posture improves: removes catastrophic backtracking vector.
- Functional contract preserved: same output structure (`team`, `w`, `l`, `record`, etc.).

## Tradeoffs
- Not a full HTML parser; relies on well-formed table closing tags.
- Simpler and safer than regex over arbitrary whole-document content.

## Rollback Plan
Revert commit on `feat/league-link-standings` if field parsing regressions appear.
