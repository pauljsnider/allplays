# Architecture Role Notes

## Decision
Use value-coupling in test setup: `elapsedAtSwitch` is both asserted and reused as rebasing input.

## Rationale
- Mirrors production pattern where rebasing input is derived at the switch point.
- Reduces future regression risk from mismatched literals in tests.
- Preserves stable test semantics with smallest diff.

## Control Equivalence
- No control degradation; tighter test invariant than before.
- No change in tenant/data/PHI surfaces (unit-test only).

## Rollback
Single-line revert in test file restores prior literal behavior.
