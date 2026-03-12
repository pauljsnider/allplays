Objective: preserve ICS cancellation semantics at the shared utility boundary and ensure the calendar page consumes that boundary.

Current state:
- `js/utils.js` exposes `getCalendarEventStatus(...)` and `buildGlobalCalendarIcsEvent(...)`.
- `calendar.html` imports that helper and uses it while merging Firestore and ICS events into one view model.

Proposed state:
- Keep status normalization centralized in `js/utils.js`.
- Add a static regression test against `calendar.html` so the page cannot regress to an inline object literal with `status: 'scheduled'`.
- Update the `calendar.html` utility import query string to invalidate stale browser caches.

Blast radius:
- `calendar.html` import path
- unit-test coverage in `tests/unit`
- no Firestore, auth, or data-model changes

Controls:
- No behavior changes for Firestore-backed schedule events.
- No new parser heuristics; reuse the existing shared normalization.
- Cache busting is isolated to the global calendar page’s `utils.js` import.

Rollback:
- Revert the single commit if the cache-busting import causes an unexpected deployment issue.
