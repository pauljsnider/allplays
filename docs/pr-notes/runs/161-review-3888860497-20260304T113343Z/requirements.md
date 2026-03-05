# Requirements Role (allplays-requirements-expert)

## Problem Statement
Coach override RSVP submissions can write a stale `rsvpSummary` when roster membership changed after initial page-session hydration, causing incorrect totals/not-responded counts for game-day decisions.

## User Segments Impacted
- Coach/admin: needs accurate attendance totals immediately after overrides.
- Parent: needs trust that displayed availability matches latest roster.
- Team manager/program owner: depends on accurate counts for operational planning.

## Acceptance Criteria
1. Submitting `submitRsvpForPlayer` recomputes summary using current roster membership from Firestore, not only session-cached roster data.
2. If roster changed (add/remove player) earlier in the same session, resulting `rsvpSummary.total` and `rsvpSummary.notResponded` reflect the latest roster immediately after override save.
3. Existing `submitRsvp` and `getRsvpSummaries` behavior remains unchanged to avoid broad performance/regression impact.
4. Permission-denied and not-found handling in RSVP write paths remains unchanged.

## Non-Goals
- No redesign of RSVP hydration cache strategy across all RSVP entry points.
- No Firestore schema or rules changes.
- No UI rendering changes.

## Edge Cases
- Roster fetch fails after override write: function still throws non-permission errors as before.
- Concurrent roster edits and override write: last successful summary recompute reflects latest fetched roster at recompute time.
- Recurring occurrence game IDs remain handled by existing not-found suppression during game doc update.

## Open Questions
- Should parent `submitRsvp` also force a fresh roster read for strict consistency, or keep cached path for lower read volume?
