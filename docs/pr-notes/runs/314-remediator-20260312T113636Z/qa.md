Validation target:
- Confirm `live-tracker.js` passes legacy persisted fields into `deriveResumeClockState()`.
- Confirm helper tests still pass for legacy and modern persisted clock fallback.

Planned checks:
- Run `tests/unit/live-tracker-resume.test.js`.
- Include a source-wiring assertion against `js/live-tracker.js` so the production call shape is covered.

Risk:
- Low. This change only broadens the persisted payload handed to an existing helper.
