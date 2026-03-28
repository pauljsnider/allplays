# Architecture role notes

- Blast radius: limited to the schedule CSV import parser and the `edit-schedule.html` CSV import UI flow.
- Control choice:
  - Reuse existing draft normalization and event persistence functions.
  - Add a small date-context fallback inside `readMappedDateTime` instead of changing normalization semantics globally.
  - Keep the preview list render path for initial preview/full reset, but update row status in place during field edits.
  - Handle import resilience in the page flow, not in shared db helpers, because the failure semantics are specific to CSV import UX.
- Tradeoff:
  - No transactional rollback across created events and optional notification side effects, because those writes already span separate operations and helper boundaries.
  - Instead, reduce duplicate risk by reporting partial success and keeping only failed rows queued for retry.
