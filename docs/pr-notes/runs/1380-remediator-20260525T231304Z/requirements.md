# Requirements

Acceptance criteria:
- Calendar day modal RSVP unit harness must strip the `schedule-print` ES module import regardless of cache-busting version so Vitest can evaluate the inline module with `AsyncFunction`.
- Default print schedule start/end dates must reflect local calendar days, not UTC ISO dates.
- Keep changes scoped to review feedback only.

Feedback classification:
- PRRT_kwDOQe-T586Eopa8: actionable. Harden the replacement pattern in `tests/unit/calendar-day-modal-rsvp.test.js`.
- PRRT_kwDOQe-T586Eopa9: actionable despite being marked informational because the local-day default can print the wrong window in UTC+ zones.
