# QA analysis — Issue #5195

Add a parameterized `ScheduleEventDetail` regression for Not Responded, Maybe, and Not Going:

1. Render an open Snacks assignment in Assignments.
2. Click Sign up and verify no claim request and routing to Availability.
3. Hold RSVP persistence unresolved, click Going, and verify the route remains Availability with no claim.
4. Resolve persistence and verify routing back to Assignments.
5. Verify guidance is gone and Sign up has `data-claim-readiness="ready"`.
6. Click Sign up once and verify exactly one claim request using an event with `myRsvp: 'going'`.

This state-machine regression prevents early navigation, stale readiness, stale claim payloads, and duplicate claim requests. Focused validation is the page test plus the app build.
