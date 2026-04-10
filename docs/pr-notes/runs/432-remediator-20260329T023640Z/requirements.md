Objective: remediate PR #432 review feedback for RSVP save/reload state.

Current state: setCoachPlayerRsvp saves, awaits loadRsvps(), then always re-renders from state.rsvpBreakdown and shows Saved.
Proposed state: loadRsvps returns a success boolean; save flow only shows Saved on successful reload and does not manually re-render stale state.

Assumptions:
- loadRsvps is the canonical renderer for the RSVP panel.
- Existing callers tolerate a boolean return without changes.

Recommendation: make loadRsvps signal failure instead of relying on side effects alone; keep blast radius to RSVP UI only.
