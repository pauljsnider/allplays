# Architecture Role Summary

## Decision
Unify interval semantics across frequencies by evaluating match eligibility from series anchor date, not loop increment side-effects.

## Rationale
- Weekly path already uses elapsed time modulo interval.
- Daily path should follow the same deterministic rule to prevent accidental over-generation.
- Keeping loop skip logic is acceptable for efficiency but not correctness-critical after match guard.

## Control Equivalence
- No new data flows.
- No auth/rules changes.
- Blast radius confined to pure recurrence computation.

## Rollback
Revert the single condition in `expandRecurrence` if unexpected regressions appear.
