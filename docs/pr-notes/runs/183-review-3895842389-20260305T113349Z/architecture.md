# Architecture Role Notes

- Thinking level: medium (data contract consistency across write/read boundaries).
- Current state: `publishBracket` writes top-level `publishedAt` as Firestore `Timestamp` but returns `publishedAt` as ISO string.
- Proposed state: Return `publishedAt` as the same Firestore `Timestamp` instance used in the write payload.
- Blast radius:
  - Reduced: removes type divergence between immediate return path and subsequent fetch path.
  - Minimal scope: one function-local assignment usage change.
- Controls equivalence: No auth/rules/data-access changes; only representation consistency.
