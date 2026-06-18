# Root Cause Hypothesis

`ScheduleEventDetail` is only partially migrated to the shared async pattern.

What is already standardized:
- Primary event-detail load uses `useAsyncOperation` plus `toAppServiceError`.
- Parent RSVP uses `useScheduleEventRsvp`.
- Rideshare load/mutations use `useScheduleRideOffers`.

What is still hand-rolled in the same workflow:
- Staff RSVP override in `ScheduleEventDetail.tsx`
- Practice packet load / complete in `PracticePacketSection`
- Practice attendance load / save in `PracticePacketSection`

Those remaining paths still use local `setLoading` / `setError` / `try` / `catch` / `finally` blocks and mostly surface raw `error.message` strings from `scheduleService`. That creates the inconsistency described by #2360:
- error copy is not normalized by error type
- loading / saving state shape differs by panel
- retry / clear behavior is bespoke per action
- scoped failures are harder to keep isolated from the rest of the page

# Likely Files

- `apps/app/src/pages/ScheduleEventDetail.tsx`
  - Remaining manual async state lives here (`submitStaffRsvpOverride`, `refreshPacket`, `refreshAttendance`, `markComplete`, `updateAttendanceStatus`).
- `apps/app/src/lib/useAsyncOperation.ts`
  - Reuse as-is unless a tiny option addition is needed; current API already looks sufficient.
- `apps/app/src/lib/appErrors.ts`
  - Reuse for typed mapping; likely add only small local message helpers, not a broad refactor.
- `apps/app/src/hooks/schedule/useScheduleEventRsvp.ts`
  - Good reference for the target pattern.
- `apps/app/src/hooks/schedule/useScheduleRideOffers.ts`
  - Good reference for scoped load-vs-mutation async state.
- `apps/app/src/lib/scheduleService.ts`
  - Likely no broad rewrite. Touch only if one of the attendance / packet / staff RSVP paths must preserve status/type metadata better.
- `apps/app/src/pages/ScheduleEventDetail.test.tsx`
  - Best place for focused regression coverage because the missing behavior is page/panel scoped.

# Test Plan

Smallest focused tests that should fail before the fix:

1. `ScheduleEventDetail` practice attendance load uses normalized async error copy
- Render a practice event with admin access.
- Mock `loadStaffPracticeAttendance` to reject with a network-style error.
- Assert the attendance panel stays scoped and shows normalized offline copy instead of the raw thrown message.

2. `ScheduleEventDetail` practice attendance save failure is scoped and reversible
- Render loaded attendance.
- Click a status button to trigger optimistic update.
- Mock `saveStaffPracticeAttendance` to reject.
- Assert the row reverts to the prior snapshot, an error banner appears inside the practice packet section, and the rest of the event detail page remains rendered/usable.

3. `ScheduleEventDetail` staff RSVP override failure uses shared typed messaging
- Render admin event with breakdown loaded.
- Mock `submitStaffScheduleRsvpOverride` to reject with permission or network semantics.
- Assert the breakdown remains mounted and the failure message is normalized through the shared mapper instead of raw `error.message` plumbing.

Nice-to-have only if the patch also touches packet completion:
- packet completion failure shows scoped normalized error and does not clear the loaded packet

# Minimal Patch Plan

1. Keep the current primary-load, parent-RSVP, and rideshare implementations intact.
2. In `ScheduleEventDetail.tsx`, replace the remaining hand-rolled event-detail action flows with panel-scoped `useAsyncOperation` instances:
   - one for staff RSVP override mutation
   - one for practice packet load / complete
   - one for practice attendance load / save
3. Add small local error-message helpers next to these flows, mirroring the existing RSVP and rideshare helpers and using `toAppServiceError(...)`.
4. Preserve existing optimistic attendance behavior, but move success/error/finally bookkeeping into `run(..., { onSuccess, onError, onFinally, rethrow: false })` so the state lifecycle matches the rest of the page.
5. Do not broaden the change into other game-day panels or a global service rewrite.

Recommended scope boundary:
- yes: staff RSVP override, practice packet, practice attendance
- no: game hub, lineup builder, live chat/reactions, scorekeeping, unrelated schedule list pages

# Validation Command

Not run in this analysis task, but the smallest validation target is:

`npx vitest run apps/app/src/pages/ScheduleEventDetail.test.tsx --reporter=verbose`

If the patch is split further, rerun that file plus any newly added targeted test names.

# Recurrence Risk

Medium.

The page is large and already mixes shared async helpers with older ad hoc async code, so new action panels can easily regress back to local `try/catch/finally` patterns. The safest prevention is to keep future event-detail mutations behind tiny hook/helper wrappers that always pair `useAsyncOperation` with typed `toAppServiceError` message mapping.