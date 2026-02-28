# Requirements Role Summary

## Objective
Address PR #103 review-critical timezone parsing risks without regressing existing ICS import behavior.

## User outcomes
- Imported events preserve intended absolute time across UTC (`Z`), numeric offset, and `TZID` values.
- Invalid timezone inputs do not silently map to incorrect local browser times.
- DST spring-forward gap times are explicitly rejected to avoid corrupt schedules.

## Acceptance criteria
- Browser compatibility: parser computes timezone offsets even when `Intl` `shortOffset` formatting is unavailable.
- Error handling: unresolved `TZID` values emit warnings and do not produce shifted local-time timestamps.
- Offset validation: invalid offsets (`HH > 23` or `MM > 59`) are rejected with warnings.
- DST gap handling: non-existent local times fail closed (event datetime dropped) and warning emitted.
- Existing happy-path tests for UTC/TZID/numeric offsets still pass.
