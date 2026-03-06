# QA Role (Fallback Inline Analysis)

- Validation target: confirm `calendar.html` references updated `./js/utils.js?v=9` import for module containing `getCalendarEventType`.
- Risk addressed: stale module cache serving incompatible export surface.
- Suggested manual check: load `calendar.html` in a browser session with cache disabled/empty and verify no module export error in console.
- Repo testing note: AGENTS/CLAUDE indicate no automated test runner requirement for this static import-string change.
