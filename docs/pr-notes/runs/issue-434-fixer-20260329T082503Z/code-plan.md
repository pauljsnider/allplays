# Code Role

## Root Cause
`renderPracticePackets()` filters row visibility by `selectedPlayerId`, but it still renders `row.childNames`, `row.children`, and the completion denominator from the full family row. A child filter therefore leaves multi-child packet content partially unscoped.

## Planned Change
1. Extend `js/parent-dashboard-packets.js` with pure helpers for:
   - visible children for a row
   - scoped completion summary
   - child-specific completion request payload
2. Add focused unit coverage for multi-child scoped rendering data and completion payloads.
3. Swap `parent-dashboard.html` packet rendering to use the scoped helper outputs.

## Why This Is Smallest Viable
- No new framework or harness.
- No refactor of packet data loading.
- Fix is isolated to the exact row fields that currently ignore the filter.
