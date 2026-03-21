Coverage target:
- Resumed live game with partial persisted scoring data must keep requested final scores on Save & Complete.
- Resumed game after clearing the log must still keep requested final scores.
- Complete score logs that match the live score may still reconcile to log-derived totals.

Validation plan:
- Add unit assertions for the new final-score resolver helper.
- Add a source-wiring assertion that `js/live-tracker.js` delegates to the helper.
- Run targeted Vitest for `tests/unit/live-tracker-integrity.test.js` and adjacent live-tracker suites.

Residual risk:
- This does not drive a browser UI end-to-end; it relies on a pure helper plus wiring assertion because the repo’s maintained automated harness is unit-first.
