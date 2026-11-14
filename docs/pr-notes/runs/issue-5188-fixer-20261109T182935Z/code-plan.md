# Code plan

> Main-lane synthesis: the requested allplays-code-expert skill was unavailable and the required subagent runtime failed before producing output.

1. Add the AssignmentClaimReadiness type to AssignmentCard and expose it on Sign up.
2. Derive readiness in AssignmentsSection from normalized RSVP state.
3. Pass readiness to every rendered assignment card.
4. Update ScheduleEventDetail tests for Going claim and RSVP-independent release.
5. Run the focused Vitest file, inspect the diff, and commit source, test, and artifacts together.
