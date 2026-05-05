# Architecture Notes

## Root cause
The live tracker module imports video timestamp helpers from `live-stream-utils.js`. Dynamic unit harnesses rewrite `js/live-tracker.js` imports into injected dependencies; a broad named-import regex could consume neighboring imports, which masks missing harness dependencies and leaves helpers such as `hasConfiguredLiveStream` undefined at runtime.

## Target files
- `tests/unit/live-tracker-retry-queue.test.js`
- `tests/unit/live-tracker-start-over.test.js`
- `tests/unit/live-tracker-opponent-stats.test.js`

## Minimal design
Keep production code unchanged. Ensure live-tracker harnesses explicitly inject video stream helper dependencies and tighten the import matcher so it only matches one named import statement at a time.

## Risks and rollback
Risk is limited to unit test harness setup. Rollback is reverting the harness regex/dependency injection changes.
