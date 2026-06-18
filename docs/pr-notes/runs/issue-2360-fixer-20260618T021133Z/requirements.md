# Acceptance Criteria

1. **Primary event-detail load uses one shared async state pattern.** When a parent, coach, or admin opens a schedule event detail page, the initial load must drive a single observable loading state for the page shell and a single consistent fetch-error treatment for the main event payload. If the first load fails, the user sees one event-level error message with a retry action and no conflicting duplicate error banners.
2. **Successful primary load preserves current event-detail behavior.** After the shared primary load completes, the page still resolves the selected child, section routing, and event summary exactly as today for single-child and multi-child families.
3. **Parent RSVP updates use the shared action async pattern.** When a parent changes RSVP or saves an RSVP note, the affected availability controls show in-flight feedback, clear stale success/error state before retry, and update only the relevant availability area on success.
4. **Practice attendance updates use the shared action async pattern where attendance is exposed on event detail.** When a coach/admin marks a player present, late, or absent from the practice packet area, only that attendance row/action enters a busy state, success/error feedback stays scoped to attendance, and the rest of event detail remains interactive.
5. **Rideshare load and core rideshare mutations use the shared action async pattern.** Loading offers, creating an offer, requesting a seat, cancelling a request, changing request status, and opening/closing an offer must follow the same user-visible loading/error/reset behavior rather than each flow inventing its own variant.
6. **One action failure does not take down the whole page.** If RSVP save, attendance save, or a rideshare mutation fails, the failure surfaces only in that section, the user can retry from that section, and other event-detail sections remain usable without a full-page reload.
7. **Retry is available at the point of failure.** For primary load failure, the retry control is page-level. For RSVP, attendance, and rideshare failures, retry is available through the same control the user already used or an adjacent scoped retry affordance, without forcing navigation away.
8. **Error copy is consistent by failure type.** Fetch/load failures use a consistent “unable to load…” style, action failures use a consistent “unable to save/update…” style, and copy stays specific enough that parents, coaches, and admins know what failed.
9. **No scope expansion into unrelated event-detail tools.** Game hub, assignments, live chat/reactions, lineup, wrap-up, and other deferred panels do not need to be migrated in this issue unless they are directly touched as a dependency of the shared async abstraction.

# User Journeys

## 1. Parent opens event detail and responds to RSVP
- Parent opens an event from Schedule.
- Page shows one clear loading treatment until core event detail is ready.
- Parent sees availability controls, changes RSVP, and optionally edits a note.
- Only the RSVP controls show saving state.
- On success, the RSVP badge/summary updates without disturbing rideshare or other sections.
- On failure, the parent sees a local RSVP error and can immediately try again.

## 2. Parent uses rideshare after RSVP fails
- Parent opens event detail.
- RSVP save fails due to a transient backend/network issue.
- Availability section shows the failure locally.
- Parent switches to Rideshare and can still request or offer a ride.
- The page does not reset, blank, or show a blocking full-page error because one action failed.

## 3. Coach/admin updates practice attendance
- Staff user opens a practice event detail with attendance controls.
- Staff marks one player late or absent.
- Only that player’s attendance action shows busy feedback.
- On success, the attendance count and that player row update.
- On failure, the prior attendance state is preserved or restored clearly enough that staff can trust what actually saved, and the rest of practice packet/event detail remains usable.

## 4. Parent/coach retries after rideshare load failure
- User opens Rideshare and the offers load fails.
- Event summary and other sections still render.
- Rideshare section shows a scoped error with retry.
- After retry succeeds, offers render normally without reloading the full page.

# Edge Cases

- Multi-child families where one shared event payload contains multiple child-specific event rows; async updates must not overwrite the wrong child’s RSVP or note.
- Practice events with attendance controls and packet controls on the same screen; an attendance failure must not erase packet state or packet-completion status.
- Rideshare refresh after a mutation; if the mutation succeeds but follow-up reload fails, the user should get a rideshare-scoped recovery path instead of a silent mismatch.
- Event is cancelled or availability is locked while the user is on the page; busy/disabled states should remain truthful and not imply the action can still be completed.
- First-load failure versus section-load failure; users must be able to distinguish “this page did not load” from “this one tool on the page failed.”
- Slow network causing repeated taps; shared async handling should prevent duplicate submissions for the same control while not freezing unrelated controls.
- Staff attendance optimistic update rollback; if save fails, the visible row and counts must return to a trustworthy state.
- Existing section-specific success banners should not stack with a new generic async error in a way that creates contradictory messages.

# Recommended Scope Cuts

- Keep this issue focused on: primary event-detail load, parent RSVP/note save, practice attendance save/load, and rideshare load/mutations.
- Do not retrofit every async flow in `ScheduleEventDetail.tsx` during this pass.
- Do not redesign wording or visual styling beyond what is needed to make shared async states consistent.
- Do not change data contracts, Firestore schema, or cross-page cache behavior unless required for parity.
- If attendance is judged too risky for this PR, the fallback cut should be RSVP + rideshare + primary page load only, but that should be called out explicitly because the acceptance language currently names attendance as an equivalent core workflow.

# Risks

- A too-generic shared async helper could erase important differences between page-level load failures and section-level action failures.
- Refactoring event detail broadly is risky because the page contains many unrelated async panels; touching too much increases regression chance.
- Multi-child event state updates are easy to regress if a shared abstraction keys only by event id and not child-specific context where needed.
- Optimistic attendance updates can leave staff unsure what really saved unless rollback behavior is explicit and reliable.
- Rideshare currently depends on follow-up refreshes for derived summaries; shared async changes must preserve summary freshness and not leave stale counts visible.

**Recommendation for implementation constraints:** limit the abstraction to one shared primary-load async state and one reusable section-action async pattern that supports scoped loading/error/retry; apply it only to event detail load plus RSVP, attendance, and rideshare flows, and require no regressions in multi-child updates or section isolation.