Decision: keep `resolveRsvpPlayerIdsForSubmission(...)` strict for explicitly scoped flows and add a calendar-only fallback helper for no-scope events.

Current state:
- `calendar.html` switched from `playerIdsByTeam` fallback to unconditional scoped resolution.
- That centralized the decision in a helper that cannot distinguish "scoped parent event" from "legacy unscoped calendar event."

Proposed state:
- Add `resolveCalendarRsvpPlayerIdsForSubmission(...)` in `js/parent-dashboard-rsvp.js`.
- The helper uses event scope when present, and otherwise returns the caller-provided legacy fallback ids.
- `calendar.html` passes the old `playerIdsByTeam` payload into that helper.

Why this path:
- Smallest change that preserves the stricter parent dashboard contract.
- Keeps the blast radius inside one shared helper and one call site.
- Makes the legacy-vs-scoped decision explicit and testable.

Conflict resolution:
- Requirements favored preserving old calendar behavior for unscoped events.
- QA favored keeping strict errors for ambiguous multi-child parent flows.
- Chosen direction: strict scoped resolver stays intact; only calendar gets the legacy fallback branch when scope metadata is absent.

Rollback:
- Revert the new helper and calendar call-site change. No data migration or cleanup required.
