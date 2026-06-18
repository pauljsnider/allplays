# Current State

- `apps/app/src/pages/ScheduleEventDetail.tsx` manages the primary event-detail load with ad hoc `loading` / `error` / `events` state. On failure it clears `events`, which turns the whole route into a full-page error state.
- The route does not currently use the shared async helper (`useAsyncOperation`) or typed load errors (`AppServiceError`) already used by `Schedule.tsx`, `Home.tsx`, and `Teams.tsx`.
- RSVP, rideshare, and practice attendance each implement their own local async state:
  - `useScheduleEventRsvp.ts`: manual `submitting/message/error` state.
  - `useScheduleRideOffers.ts`: manual `loading/submitting/message/error` state plus list refresh.
  - `PracticePacketSection` in `ScheduleEventDetail.tsx`: manual attendance load/save/error state with optimistic updates.
- `scheduleService.ts` already provides the right domain entry points and native/REST fallback behavior, but most event-detail mutations still surface plain `Error` instances instead of consistently mapped typed errors.
- `loadParentScheduleRideOffers()` currently swallows load failures with `.catch(() => [])`, which collapses “failed to load” into “no offers” and makes section-level recovery harder.
- There is already an app-level server-state/cache primitive (`appDataCache`) for parent schedule summary data, and `scheduleService.resolveParentGameRoute()` already reads that cache.

# Proposed State

Use the existing shared primitives instead of introducing TanStack Query or rewriting schedule services:

1. **Primary load standardization**
   - Wrap Schedule event detail primary load in `useAsyncOperation`.
   - Normalize route-level failures with `toAppServiceError(..., 'Unable to load event details.')`.
   - Seed the route from the existing cached parent schedule summary when a matching `(teamId, eventId)` snapshot exists, then refresh from `loadParentScheduleEventDetail()`.
   - Only show the blocking full-page error when there is no usable seeded or previously loaded event snapshot.
   - If refresh fails after seed/initial success, keep the current event visible and show a non-blocking route-level error banner with retry.

2. **Mutation/load standardization for page sections**
   - Reuse `useAsyncOperation` for:
     - parent RSVP submit
     - rideshare load + rideshare mutations
     - practice attendance load + attendance save
   - Convert caught failures to `AppServiceError` at the page/hook boundary (or in a tiny event-detail-specific helper) so the UI can distinguish `network`, `permission`, `validation`, and `not_found` outcomes without broad service rewrites.

3. **Scoped server-state ownership**
   - Keep the route-level `events` array as the canonical event snapshot for shared fields (`myRsvp`, `myRsvpNote`, `rsvpSummary`, `rideshareSummary`, attendance summary text).
   - Keep rideshare offers and practice attendance as section-scoped server state owned by their respective hook/panel.
   - Mutations patch only the relevant slice of route state after success (or optimistic update + rollback where already used, like attendance).

4. **Failure isolation by section**
   - Rideshare load failure should preserve the rest of the event page and keep the last known rideshare summary if available.
   - RSVP failure should leave the current event snapshot intact and only show inline availability feedback.
   - Attendance load/save failure should stay inside the practice packet/more section and never blank the page.

# Architecture Decisions

## 1. Reuse existing helpers instead of introducing a new data framework
- Use `useAsyncOperation` for lifecycle consistency.
- Use `AppServiceError` / `toAppServiceError` for typed error handling.
- Reuse `appDataCache` only for route seeding, not for new generalized event-detail caching.
- Do **not** introduce TanStack Query, shared query clients, or service-wide abstractions.

## 2. Preserve a single canonical route snapshot
- `events` in `ScheduleEventDetail` remains the source of truth for the loaded event group.
- Section hooks can own transient fetch state, but successful writes must reconcile back into `events` via `updateEvents()`.
- All event patches must continue to match by `teamId` + `id`, and child-specific RSVP changes must only update the matching `childId` row.

## 3. Stop collapsing errors into empty data
- `loadParentScheduleRideOffers()` should no longer silently translate failures into `[]` if this page needs to show a real recoverable error state.
- Similar event-detail loaders/mutations should surface typed failures so UI policy stays in the hook/page layer.

## 4. Keep optimistic updates narrow and reversible
- Attendance already uses optimistic row updates plus rollback; keep that pattern but standardize error typing and busy/error lifecycle via `useAsyncOperation`.
- RSVP and rideshare should prefer last-known-good state over clearing data on failure.

## 5. Prefer page-scoped helpers over service churn
Smallest safe extraction:
- a primary-load helper/hook for Schedule event detail
- a tiny event-detail async error mapper (or direct `toAppServiceError` usage)
- optional conversion of the handful of event-detail service functions to typed errors only where needed

This keeps the blast radius local and avoids changing unrelated schedule consumers.

# Failure Isolation

## Primary route load
- **No cached/prior event available:** show the existing blocking route error state.
- **Cached or already loaded event available:** keep rendering event content, show a route banner/status, and allow retry.
- This preserves page usability during transient network/native bridge failures.

## RSVP
- Failure affects only the availability panel.
- Keep current RSVP/note visible until a successful write lands.
- Show inline error and re-enable controls.
- Do not clear route-level messages or unrelated section state.

## Rideshare
- Load failure affects only the rideshare tab/section.
- Keep prior offers list if one exists; otherwise show a rideshare-specific empty/error state with retry.
- Do not overwrite the route event’s existing `rideshareSummary` with an empty synthesized summary on load failure.
- Mutation failure should preserve the last successful offers snapshot and only surface inline status.

## Practice attendance
- Load failure affects only attendance UI inside the practice packet/more section.
- Save failure should roll back the optimistic attendance snapshot for that section only.
- Packet content and the rest of event detail remain usable.

## Staff/admin adjunct loads
- Staff RSVP breakdown and attendance permission failures should degrade to scoped blocked states, not route failure.
- Permission/not-found should be distinguishable from transient network issues so copy can match reality.

# Risks And Rollback

## Risks
- **Seed mismatch risk:** cached schedule summary data is lighter than full detail data. The route must treat cache as a temporary render seed and always refresh authoritative detail state.
- **Double-state drift risk:** route `events` plus section-local offers/attendance can diverge if successful mutations do not reconcile both layers consistently.
- **Behavioral change risk:** removing swallowed rideshare errors may expose real failures that tests do not currently assert.
- **Typed error adoption risk:** changing too many service throw paths would create unnecessary blast radius.

## Rollback
- Safe rollback is straightforward because this architecture is page-scoped:
  - revert the new Schedule event detail async wrappers/hooks
  - restore the current direct `useState` flow
  - leave schedule services, schemas, and Firestore writes unchanged
- No data migration or permission-rule rollback is required.

# Open Questions

1. Should primary-load seeding use only the in-memory `appDataCache`, or also accept persisted stale schedule summary entries from storage for offline-ish recovery?
2. For a seeded route refresh failure, should the banner copy say “Showing last loaded details” or remain generic to avoid overstating freshness?
3. Should `loadParentScheduleRideOffers()` itself stop swallowing errors, or should a new event-detail-specific loader wrap `loadRideOffers()` directly to avoid changing other consumers?
4. Do we want one tiny shared helper for page-level typed async actions (essentially `useAsyncOperation` + `toAppServiceError`), or is direct composition in this route/hooks clearer and smaller?
5. Should practice attendance load/save errors use the same typed copy strategy as schedule/home (`network` retry wording vs `permission` blocked wording), or keep current literal service messages?

**Recommended implementation pattern:** add a page-scoped `useScheduleEventDetailLoad` flow that uses `useAsyncOperation` + `toAppServiceError`, seeds from cached schedule summary when available, preserves last-known-good route data on refresh failure, and refactor RSVP, rideshare, and attendance async work to use the same typed async pattern with section-local failure isolation and minimal service changes.