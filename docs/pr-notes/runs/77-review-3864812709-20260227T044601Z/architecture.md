# Architecture Role Summary

## Decision
Use Firestore transaction semantics for admin invite persistence instead of best-effort batch updates with pre-reads.

## Why
- Transaction aligns read preconditions (`team exists`, `code exists`, `unused`, `type`, `teamId`) with writes in one concurrency-safe unit.
- Retries on contention prevent stale precondition commits.

## Control Equivalence
- Access control improves over prior behavior by requiring valid invite invariants before persisting admin access.
- Auditability maintained through `usedBy`, `usedAt`, and `updatedAt` fields.

## Tradeoff
- Slightly higher complexity in persistence function, but lower operational risk and fewer edge-case corruption paths.
