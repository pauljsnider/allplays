# Architecture Role Synthesis

## Root Cause
`resolveRsvpPlayerIdsForSubmission` allowed implicit fallback to all players in a team/event scope. With shared event docs, this can over-apply one RSVP action.

## Minimal Patch Strategy
- Keep data model and DB write path unchanged.
- Tighten client-side resolver logic:
  - return explicit scoped IDs when provided and valid
  - if no explicit context and exactly one allowed player exists, use it
  - if no explicit context and multiple allowed players exist, return empty (ambiguous)

## Risk Surface
- Low blast radius: only submission player ID resolution changes.
- Potential UX effect: ambiguous grouped actions will no longer fan out silently.
