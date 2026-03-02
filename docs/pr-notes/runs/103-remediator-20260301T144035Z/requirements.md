# Requirements Role Notes

## Objective
Resolve all unresolved PR #103 review comments in `js/utils.js` for ICS timezone parsing correctness and safety.

## Current vs Proposed
- Current: TZID parsing already includes fallback behavior, convergence checks, and null-on-failure handling.
- Proposed: close remaining validation gap for parsed `GMT±HH[:MM]` offsets so invalid offsets cannot be accepted.

## Risk Surface / Blast Radius
- Affects calendar import time parsing only.
- Blast radius is limited to ICS event datetime conversion paths.

## Assumptions
- Existing fallback path for unsupported `shortOffset` should remain.
- Null return for invalid/ambiguous TZID conversion is preferred over silent local-time fallback.

## Success Criteria
- Invalid/unsupported GMT offset strings are rejected.
- Existing TZID conversion behavior remains stable for valid inputs.
