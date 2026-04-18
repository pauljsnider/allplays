# Architecture

## Current State
- The parent dashboard calendar modal test seeds a shared game on a fixed date: 2026-04-15.
- `getFilteredScheduleEvents()` defaults to `upcoming-all`, which excludes events older than roughly 3 hours before the current runtime.
- Once wall clock time passed the seeded date, the modal rendered `No events on this day.` and the test failed before RSVP assertions.

## Proposed State
- Make the test fixture date relative to runtime so the seeded event remains in the upcoming set.

## Architecture Decisions
- Fix the brittle test input, not production code.
- Keep the default schedule filtering behavior unchanged because the failure is caused by stale test data, not incorrect modal logic.

## Risks And Rollback
- Low risk. Scope is limited to one unit test fixture.
- Rollback is reverting the test-date change if it unexpectedly masks a real product issue.