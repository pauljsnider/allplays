# Code Plan

## Target files
- `tests/unit/live-tracker-retry-queue.test.js`
- `tests/unit/live-tracker-start-over.test.js`
- `tests/unit/live-tracker-opponent-stats.test.js`

## Exact issue
`js/live-tracker.js` calls video stream helper functions inside `renderVideoTimestampStatus()`. The dynamic test harnesses rewrite imports into dependency objects, and the named-import matcher was broad enough to consume adjacent import statements. That can hide missing harness dependencies and leave helpers undefined during evaluated test execution.

## Minimal patch
Keep the explicit `./live-stream-utils.js` harness dependency injection and tighten each harness `replaceNamedImportByModulePath()` regex from cross-import `[\\s\\S]*?` matching to a single import body match, `[^}]*`.

## Local validation
- `npx vitest run tests/unit/live-tracker-retry-queue.test.js tests/unit/live-tracker-start-over.test.js tests/unit/live-tracker-opponent-stats.test.js`
- `npm test -- --run`
