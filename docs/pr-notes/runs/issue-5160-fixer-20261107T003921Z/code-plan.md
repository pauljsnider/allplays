# Code plan

The named `allplays-code-expert` and orchestrator skills were unavailable, so this plan synthesizes the four role analyses with repository evidence.

1. Add focused `RegistrationsTool` component tests first, mocking `parentRegistrationsService`.
2. Preserve the published-form load and card implementation.
3. Add independent application page state and a merge helper that handles Firestore timestamps, deduplication, and deterministic newer-first ordering.
4. Add initial, pagination, and retry loaders that never clear accumulated successful applications.
5. Render a read-only Submitted applications section with loading, empty, partial-error, retry, and Load more states.
6. Update the existing `ParentTools.test.tsx` focused-service mock with a default empty application page.
7. Run focused tests and the app build, then commit all code, tests, and run artifacts together.

## Root cause and prevention

The service capability was added without wiring its independent lifecycle into the React consumer. Future historical-list slices must add consumer state/tests for visibility independent of active catalog items, non-destructive partial failure handling, pagination deduplication, and closed-source-record visibility.
