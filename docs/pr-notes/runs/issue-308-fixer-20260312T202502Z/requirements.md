Objective: ensure cancelled ICS events remain cancelled on the global calendar so families do not see canceled games or practices as active.

Current state:
- The shared calendar utilities already normalize ICS cancellation from both `STATUS:CANCELLED` and TeamSnap-style summary prefixes.
- `calendar.html` currently builds synced ICS entries through `buildGlobalCalendarIcsEvent(...)`, but there is no page-level regression test proving that contract remains in place.

Proposed state:
- Keep the global calendar page wired to the shared cancellation helper path.
- Add regression coverage so a future inline remap cannot silently force synced ICS events back to `scheduled`.

Risk surface and blast radius:
- Blast radius is limited to global calendar ICS rendering and cache invalidation for `js/utils.js`.
- Main risk is stale browser cache serving an older `utils.js` bundle that predates the cancellation-preserving helper path.

Assumptions:
- Cancelled ICS events should remain visible but styled as cancelled, matching the rest of the app.
- Shipping the current helper logic to clients may require a cache-busting import version update on `calendar.html`.

Recommendation:
- Lock the page to the shared helper with a focused regression test.
- Bump the `utils.js` import version in `calendar.html` so the fixed helper is fetched by browsers.

Success criteria:
- Unit tests fail if `calendar.html` stops using `buildGlobalCalendarIcsEvent(...)`.
- The global calendar page fetches the latest shared utility module instead of a potentially cached pre-fix copy.
