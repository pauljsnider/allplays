# Architecture Role (allplays-architecture-expert)

## Root Cause
The historical failure mode was page-level ICS mapping overriding parsed cancellation metadata. The current safe path is the shared `buildGlobalCalendarIcsEvent` helper in `js/utils.js`; the remaining architecture concern is keeping cancellation normalization centralized so page views stay consistent.

## Minimal Safe Fix
- Keep global calendar ICS mapping in the shared helper.
- Normalize cancelled summary prefixes once in `js/utils.js` so the helper can preserve status while cleaning the displayed title.
- Add an explicit cancelled label in compact rendering for consistency with detailed and day-detail views.

## Blast Radius
- Limited to global calendar ICS rendering in `js/utils.js` and `calendar.html`.
- No Firestore, auth, or schedule write-path changes.

## Controls
- Add focused unit tests around helper mapping and calendar source rendering.
- Bump the `utils.js` cache-busting query parameter in `calendar.html`.
