# Code plan — Issue #5195

1. Add a page-level, event-keyed assignment-resume marker.
2. Set it only when a blocked assignment claim routes to Availability.
3. Extend the internal RSVP hook with an optional post-save callback invoked only after successful persistence and visible-state reconciliation.
4. On a successful Going response for the marked event, clear the marker and select Assignments.
5. Add the full transition regression before implementation and verify it fails on the one-way flow.
6. Run the focused page test and app build, then review and commit all code, tests, and role artifacts together.

The persistence and claim service APIs remain unchanged. No automatic claim is introduced.
