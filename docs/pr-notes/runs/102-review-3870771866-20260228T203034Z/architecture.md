# Architecture Role Summary

## Decision
Implement a minimal helper-level fix: replace falsy guard with explicit nullish guard.

## Why
- Centralized in `isAccessCodeExpired`; no call-site sprawl.
- Preserves existing coercion logic (`toMillis`, `Date`, numeric).
- Avoids behavior change for non-numeric invalid values (still returns non-expired).

## Controls
- No schema changes.
- No additional permissions or Firestore rule changes.
- Regression constrained to helper logic and unit tests.
