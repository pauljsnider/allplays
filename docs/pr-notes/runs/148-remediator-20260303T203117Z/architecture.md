# Architecture role notes

## Current state
ICS cancellation detection uses:
- `ev.status?.toUpperCase() === 'CANCELLED'` (good)
- `ev.summary?.includes('[CANCELED]')` (case-sensitive + substring match)

## Proposed state
Normalize summary via `trimStart().toUpperCase()`, then use `startsWith('[CANCELED]')` (and accept `[CANCELLED]` spelling variant) to avoid false positives from mid-string tokens.

## Risk surface / blast radius
- Blast radius is limited to ICS event ingestion in `calendar.html`.
- UI rendering and downstream status use existing `status: 'cancelled' | 'scheduled'` behavior unchanged.
- Prefix-only check reduces false-positive cancellations.
