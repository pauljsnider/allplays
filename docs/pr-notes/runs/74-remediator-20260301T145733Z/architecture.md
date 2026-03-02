# Architecture Role Notes

Current state:
- `getTeam(teamId, options)` defaults to filtering out inactive teams.
- Some replay/history surfaces already opt into inactive inclusion, but `js/live-tracker.js` still uses default active-only lookups.

Proposed state:
- Keep `getTeam` default behavior unchanged.
- Update replay/history-oriented lookups in `js/live-tracker.js` to pass `{ includeInactive: true }`.

Risk/blast radius:
- Low; only affects metadata fetches for game viewing/tracking flows.
- No schema or permission changes.
