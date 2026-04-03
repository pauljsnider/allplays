Current state: `parent-dashboard.html` aggregates duplicate child schedule rows into one calendar entry via `getCalendarEntries`, renders modal RSVP buttons with `data-child-ids`, and delegates submission to `createParentDashboardRsvpController`.

Observed gap: the controller mutates `allScheduleEvents` and calls `renderScheduleFromControls`, but it has no hook to refresh `activeDayModal`, so an already-open modal can keep stale button classes and summary text after a successful save.

Proposed state: add an optional post-render callback to the shared RSVP controller and pass `rerenderActiveDayModal` from `parent-dashboard.html`. This keeps the fix targeted to RSVP flows and avoids broad render-path changes.

Blast radius: small. The change touches only the shared RSVP controller contract and the parent dashboard caller.
