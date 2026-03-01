# Architecture Role (Fallback Inline Analysis)

- Current state: `calendar.html` imports `getCalendarEventType` from `./js/utils.js?v=8` while some users may still have old `utils.js?v=8` cached.
- Failure mode: browser throws module import error (`does not provide an export named`) and calendar page fails to initialize.
- Proposed state: bump import query to a new version token (`v=9`) in `calendar.html`, forcing retrieval of matching module bytes.
- Blast radius: only `calendar.html` import URL changes; no runtime logic change in `utils.js`.
- Rollback: revert one-line version token if needed.
