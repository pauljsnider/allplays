# Requirements Role Notes

## Objective
Reduce RSVP hydration read amplification during initial load when multiple unsummarized events share a team.

## User/UX Constraint
Parent and coach views must remain responsive when recurring schedules produce many event instances.

## Decision
Use per-team in-memory reuse for active roster and fallback parent profile lookups so each team roster is read once per page session during summary hydration.

## Acceptance Criteria
- Repeated `getRsvpSummary(teamId, gameId)` calls for the same `teamId` do not re-read the roster each time.
- Fallback `getUserProfile(uid)` reads for unresolved RSVP player mappings are reused per team+user.
- Existing summary counts and permission-denied behavior remain unchanged.
