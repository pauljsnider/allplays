# Code plan

## Patch plan

1. Add a failing source-wiring regression to `tests/unit/live-tracker-integrity.test.js`.
2. Import the two existing projected queue helpers in `js/live-tracker.js`.
3. Use projected validation when adding a queue entry and provide conflict feedback.
4. Add a whole-queue preflight guard at the top of `applyQueue()` so no history, logs, broadcasts, persistence, or lineup mutations occur for an invalid queue.
5. Keep the implementation aligned with the proven `js/track-basketball.js` pattern and avoid changes to the shared helper.

## Compatibility checks

No smoke test stubs serve `live-tracker-integrity.js`, and the module is not in the cache-critical cohort. Existing unit harnesses rewrite the integrity import, so avoid requiring new helpers during unrelated initialization paths or update those harness dependencies if focused tests expose a failure.
