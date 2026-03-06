# Architecture Role Notes

## Decision
Keep the existing parse pipeline and tighten offset validation in-place inside `parseShortOffsetZonePart`.

## Why
- Minimal targeted change.
- Preserves current fallback strategy (`shortOffset` -> wall-clock component diff).
- Prevents malformed offset interpretation from entering conversion loop.

## Tradeoffs
- Slightly stricter parsing may reject odd/non-standard timezone labels; this is acceptable because invalid values should fail closed.

## Controls
- Continue explicit warnings and `null` returns on failures.
- No change to broader app architecture.
