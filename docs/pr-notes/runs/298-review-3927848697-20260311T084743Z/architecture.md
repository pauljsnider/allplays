# Architecture Role (fallback synthesis)

- Requested `allplays-architecture-expert` / `sessions_spawn` tooling is unavailable in this runtime; this file captures the equivalent architecture lane output.
- Current state: recurring ICS occurrences are now tracked by occurrence-specific ids, but historical rideshare documents may still live under the master UID.
- Proposed state: write and read rideshare data through the occurrence id while passing `calendarEventUid` as a fallback candidate for lookup and mutation.
- Control assessment: this preserves current data ownership and Firestore paths; blast radius is smaller than a migration because reads/writes stay scoped to the same team and game collections.
- Cache-control assessment: bumping `utils.js` import tokens to `?v=9` prevents module export mismatches during the 1-hour JS cache window defined by hosting headers.
- Rollback path: reverting `61a19fc580` restores the prior behavior, but would reintroduce the reviewed regressions.
