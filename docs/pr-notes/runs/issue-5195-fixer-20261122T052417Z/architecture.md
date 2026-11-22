# Architecture analysis — Issue #5195

## State flow

`useScheduleEventRsvp` already updates `ParentScheduleEvent.myRsvp` through `ScheduleEventDetailContext.updateEvents`, including optimistic update, success reconciliation, and failure rollback. `AssignmentsSection` derives readiness from the current context event, so its claimability calculation is not independently cached.

## Root cause

The dependency added a one-way transition from blocked Sign up to Availability. That unmounts `AssignmentsSection`; successful RSVP persistence updates the shared event but has no continuation that remounts the assignment surface. The card therefore cannot visibly change to ready until the user manually returns.

## Design

Track the interrupted assignment journey at page scope and key it to the selected event. Add a success callback to the internal RSVP hook, leaving the service contract unchanged. Only a successful Going save for the same event clears the continuation and selects Assignments. Do not navigate from optimistic state or an RSVP-watching effect.
