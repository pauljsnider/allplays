# Architecture Role Notes

## Decision
Use a capability-gated two-path resolver:
1. Fast path: `shortOffset` parsing only if runtime supports it.
2. Stable path: wall-clock component diff (`getWallClockPartsInTimeZone`) for unsupported runtimes.

## Why
- Preserves existing accuracy and DST handling logic.
- Avoids repeated unsupported-option failures on older browsers.
- Keeps parser deterministic without relying on local timezone.

## Controls Equivalence
- Data access/auth controls unchanged.
- Error handling remains explicit with warnings and null-return for unresolvable TZID.
- Blast radius constrained to `js/utils.js` timezone helper internals.

## Tradeoffs
- Slightly more helper complexity for runtime probe state.
- Probe introduces one extra formatter invocation once per page load.
