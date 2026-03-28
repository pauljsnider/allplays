Objective: ensure synced ICS recurring events surface as full, accurate series instances in schedule and calendar views.

Current state:
- Recurring VEVENT masters are expanded, but recurrence exception VEVENTs with `RECURRENCE-ID` are treated as standalone items.
- Result: a moved or overridden instance can appear alongside the original generated occurrence, and recurring instances lack stable per-occurrence IDs for downstream linking.

Proposed state:
- Treat `RECURRENCE-ID` entries as overrides for the matching generated occurrence within the same UID series.
- Preserve one item per actual occurrence and attach a stable per-instance identifier.

Risk surface and blast radius:
- Area is limited to ICS parsing and downstream consumers of `fetchAndParseCalendar(...)`.
- Primary regression risk is altering one-off ICS parsing or existing weekly expansion rules.

Assumptions:
- The app should preserve the series UID while exposing a unique occurrence identity for each expanded item.
- Recurrence exception VEVENTs should replace the original occurrence rather than add a second visible item.

Recommendation:
- Ship a targeted parser fix plus unit coverage for recurrence overrides.
- Do not refactor schedule/calendar consumers in this change unless the parser contract requires a small compatibility field.

Success criteria:
- A recurring master with `RECURRENCE-ID` override yields one entry for the affected occurrence.
- Expanded recurring items expose stable occurrence IDs for linking/import flows.
- Existing recurrence and calendar fetch unit tests remain green.
