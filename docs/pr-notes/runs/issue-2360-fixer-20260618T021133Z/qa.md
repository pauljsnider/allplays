# Failing Invariants

1. **Primary load failure must be page-scoped and retryable.** `ScheduleEventDetail` currently falls through to a static error state when `loadParentScheduleEventDetail` fails; there is no explicit retry control coverage in `apps/app/src/pages/ScheduleEventDetail.test.tsx`, so the page-level recovery invariant is unguarded.
2. **Scoped failures must not collapse back into contradictory empty states.** `useScheduleRideOffers` clears offers and summary on load failure, and `RideshareSection` renders both the scoped error banner and the generic empty-state copy (`No ride offers yet for this event.`); there is no regression test proving the error state suppresses the empty state and exposes retry.
3. **Attendance busy/error state should stay row-scoped.** `PracticeAttendancePanel` currently disables every attendance button while any save is in flight (`disabled={saving}`), and the adjacent test explicitly locks that in (`optimistically disables all attendance buttons...`). That expectation conflicts with the issue acceptance criteria.
4. **RSVP failure recovery needs a retry-specific guard.** `useScheduleEventRsvp.test.tsx` covers success and failure once, but not “clear stale error, retry, then succeed” or multi-child isolation when only one child row should change.
5. **A section failure must not make the rest of event detail unusable.** Existing tests cover individual workflows, but not the cross-section journey where one scoped failure occurs and the user can still switch sections and complete another task without a page reload.

# Recommended Regression Tests

## 1. Page-level load failure + retry (`apps/app/src/pages/ScheduleEventDetail.test.tsx`)
- Mock `loadParentScheduleEventDetail` to reject once, then resolve.
- Assert one event-level failure message, no duplicate conflicting error/status banners, and a page-level retry button.
- Click retry and assert the page recovers to the normal event heading/summary.
- Also assert the loading skeleton is replaced by the error state, not left hanging.

## 2. RSVP retry + child isolation (`apps/app/src/hooks/schedule/useScheduleEventRsvp.test.tsx`)
- Extend the harness to include two child event rows for the same `teamId`/`eventId`.
- First submission rejects, second succeeds.
- Assert the first failure message clears on retry, success message appears, and only the targeted child row changes `myRsvp`/`myRsvpNote` while the sibling row stays untouched.
- Keep the shared `rsvpSummary` update assertion because that is the intended shared payload.

## 3. Rideshare load failure isolation + scoped retry (`apps/app/src/pages/ScheduleEventDetail.test.tsx`)
- Start on `section=rideshare` with a successful primary event load but `loadParentScheduleRideOffers` rejecting once, then resolving.
- Assert event summary/header still render, the rideshare panel shows a scoped load error, generic “No ride offers yet” copy is suppressed, and a rideshare-local retry affordance is present.
- Retry inside rideshare and assert offers render without reloading the whole event detail payload.

## 4. Rideshare mutation failure isolation (`apps/app/src/hooks/schedule/useScheduleRideOffers.test.tsx`)
- Keep the existing focused hook style and add one retry-oriented failure case for a core mutation (create offer is the smallest adjacent path already covered).
- Assert a failed mutation leaves offers/summary unchanged, clears stale error on retry, then refreshes offers and summary on success.
- If implementation adds a generic ride action helper, one create-offer test is enough as the representative mutation contract; the page test can cover the section-level UX.

## 5. Attendance save failure rollback + row-scoped busy state (`apps/app/src/pages/ScheduleEventDetail.test.tsx`)
- Replace/update the current “disables all attendance buttons” expectation.
- Save one player status with a deferred promise.
- Assert only that row shows busy feedback / is disabled, sibling rows remain interactive, optimistic count updates locally, and a rejected save restores the original row/count state with a scoped attendance error.
- Then assert the user can still use another event-detail section after the attendance failure.

## 6. Section usability after scoped failure (`apps/app/src/pages/ScheduleEventDetail.test.tsx`)
- One integrated journey: fail RSVP or rideshare action, verify the scoped error appears, switch to another section (`Rideshare`, `Assignments`, or `Game/More`) and confirm its core UI still works.
- This is the highest-value cross-cutting isolation test for the bug class from the RCA playbook (“hidden async work / scoped UI state gaps”).

# Manual Checks

1. **Initial event load failure**
   - Open an event detail route on throttled/offline network.
   - Confirm a single page-level failure state appears with retry.
   - Restore network, tap retry, and confirm the same route recovers without navigation away.

2. **Parent RSVP failure isolation**
   - As a parent on a multi-child event, fail RSVP once (offline/devtools/mock).
   - Confirm only Availability shows the error, the rest of the page remains visible, and the sibling child context is unchanged.
   - Retry from the same control and confirm success updates the badge/summary.

3. **Rideshare load and mutation isolation**
   - Enter Rideshare with event detail otherwise loaded.
   - Fail rideshare load once and verify header, player switcher, and other tabs still work.
   - Retry inside Rideshare and confirm offers load.
   - Then fail create/request/cancel once and verify the error stays local to Rideshare and can be retried without full page refresh.

4. **Practice attendance rollback**
   - As staff/admin on a practice event, change one player to late/absent.
   - Force save failure.
   - Confirm only that row/action shows busy, then the row/count rollback is trustworthy after failure, packet content remains intact, and another section is still usable.

5. **Scoped error does not poison page state**
   - After any local failure, switch tabs, switch child (if multi-child), and return.
   - Confirm no duplicate banners, no blank section shell, and no accidental full-page error takeover.

# Risk Matrix

| Area | Risk | Why |
| --- | --- | --- |
| Primary event-detail load retry | High | Missing recovery here blocks the whole route and is not covered by existing tests. |
| Practice attendance async state | High | Current test coverage enshrines broad disabling that conflicts with the new invariant; rollback trust is easy to regress. |
| Rideshare load failure UX | High | Current hook clears offers on failure, which can blur load-error vs empty-state behavior unless explicitly tested. |
| RSVP retry + multi-child isolation | Medium | Core success/failure exists, but retry-state reset and sibling-row protection are still uncovered. |
| Cross-section usability after scoped error | Medium | This is a bug-class regression more than a single function bug; an integration-style test is needed to keep the page from freezing after local failures. |
| Error copy consistency | Low | Easy to verify once the behavioral tests above are in place, but still worth a quick assertion sweep. |

# Exit Criteria

- `ScheduleEventDetail.test.tsx` covers: initial load failure + retry, rideshare load failure + scoped retry, attendance failure rollback with row-scoped busy state, and one cross-section usability journey after a scoped failure.
- `useScheduleEventRsvp.test.tsx` covers retry-state reset and multi-child update isolation.
- `useScheduleRideOffers.test.tsx` covers mutation retry/reset behavior without summary corruption.
- Manual verification confirms: one page-level load error path, one RSVP failure path, one rideshare failure path, and one attendance failure path all recover without forcing a full page reload.
- No test continues to assert the old invariant that all attendance buttons lock during one save.
- If implementation intentionally cuts attendance from scope, the PR must call that out as a known acceptance-criteria gap before merge.