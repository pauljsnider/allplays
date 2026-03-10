Objective: ensure cancelled synced ICS events stay cancelled in the global calendar, matching team schedule behavior.

Current state:
- ICS parsing already captures `STATUS`.
- Global calendar depends on normalized `status === 'cancelled'` for cancelled styling and filtering.
- The regression risk is any ingestion path that defaults synced ICS events back to scheduled.

Proposed state:
- Global calendar uses a shared normalization seam for ICS event type and status.
- Cancelled markers from `STATUS:CANCELLED`, `STATUS:CANCELED`, `[CANCELED]`, and `[CANCELLED]` continue through to the rendered event.

Risk surface and blast radius:
- Low blast radius. This only affects synced ICS events shown in the consolidated calendar.
- Wrong behavior is user-facing and high impact because families can act on cancelled events.

Assumptions:
- Existing cancelled rendering in `calendar.html` is the intended UX.
- No data migration is needed because the source of truth remains the ICS feed.

Recommendation:
- Add a regression test at the mapping seam and keep the implementation minimal.
