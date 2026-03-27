Objective: add targeted regression coverage for calendar day-detail RSVP updates, preserving the current UX where the modal stays open after save.

Current state:
- `calendar.html` renders DB-backed event RSVP controls inside the day-detail modal.
- Saving an RSVP updates in-memory event data and list/grid views, but not the already-open modal.

Proposed state:
- A regression test proves the day-detail modal refreshes in place after RSVP submission.
- ICS-only events remain informational and non-actionable in the same modal.

Risk surface:
- Calendar page only.
- Blast radius is limited to modal refresh behavior after RSVP submissions.

Assumptions:
- The intended UX is to keep the day modal open after save.
- Parent-linked child context should continue flowing through the existing RSVP submission helpers.

Recommendation:
- Add one focused regression that covers DB + ICS coexistence and verify the selected RSVP state and summary update without reopening the modal.
