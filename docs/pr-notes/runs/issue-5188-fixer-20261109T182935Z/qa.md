# QA analysis

> Main-lane synthesis: the requested allplays-qa-expert skill was unavailable and the required subagent runtime failed before producing output.

## Focused regressions

1. Render ScheduleEventDetail with a Going RSVP and an open assignment.
2. Assert Sign up is enabled and reports ready claim state.
3. Click once and assert the existing claim service receives the event, user, and role.
4. Render the current user's claim under a Not Going RSVP.
5. Release it and assert the existing release service receives the event and role.
