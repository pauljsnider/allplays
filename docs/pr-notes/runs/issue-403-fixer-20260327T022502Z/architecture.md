Objective: close the stale-modal gap with the smallest change that preserves current calendar rendering behavior.

Current state:
- `submitCalendarRsvp` mutates `allEvents`, calls `applyFilters()`, and intentionally skips refreshing the open modal in calendar view.

Proposed state:
- Track the currently open day-detail selection in module state and rerender that modal after RSVP writes when it is visible.

Risk surface and blast radius:
- Single-page client logic in `calendar.html`.
- No Firestore contract changes.
- No change to RSVP payload construction.

Tradeoff:
- Reopening the modal via stored day coordinates is simpler and safer than parsing localized title text or duplicating modal rendering logic in a second code path.
