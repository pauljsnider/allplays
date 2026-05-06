# Code Plan

## Files
- `tests/unit/live-tracker-retry-queue.test.js`
- `tests/unit/live-tracker-start-over.test.js`
- `tests/unit/live-tracker-opponent-stats.test.js`

## Implementation
Change each live tracker harness `replaceNamedImportByModulePath()` regex from a cross-import matcher to a single-import matcher:

- Before: `\{[\s\S]*?\}`
- After: `\{[^}]*\}`

This preserves the existing harness dependency model and ensures `buildVideoTimestampMetadata` and `hasConfiguredLiveStream` are consistently injected from `deps.liveStreamUtils`.

## Scope Control
No production code changes. No unrelated test refactors.
