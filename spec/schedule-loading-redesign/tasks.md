# Tasks: Schedule Loading Redesign

Execute one task at a time with `/spec-execute-task`; stop for review after each. Every task lists the requirements it implements (see [requirements.md](./requirements.md)) and follows the design in [design.md](./design.md). Write the failing test first where a test is listed.

## Phase 1 — Client quick wins (no schema change)

- [ ] 1. Fix the attendance "not linked to a session yet" dead end
  - In `apps/app/src/lib/scheduleService.ts`, change `saveStaffPracticeAttendance` to write via `set(doc(teams/{teamId}/practiceSessions/{eventId}), { attendance: normalizedAttendance, attendancePlayers, aiContext: { attendanceSummary } }, { merge: true })` (native path: PATCH to the deterministic path), creating the session on first mark with `sessionId == eventId` while preserving the existing nested attendance document shape.
  - Change `loadStaffPracticeAttendance` to return an empty roster-based sheet instead of throwing when no session exists.
  - Resolve sessions by exact event ID first; keep the `eventId ==` query as legacy fallback for reads only.
  - Tests: regression unit test that fails on current code (load throws / save requires pre-existing session); test that save with no session creates doc at deterministic ID; test legacy-fallback read still finds old query-keyed sessions.
  - _Requirements: 4.2, 4.3_

- [ ] 2. Allow attendance on calendar-imported practices
  - In `assertPracticeAttendanceManagementEvent`, permit practice events with `sourceType === 'calendar'` (key the session to `calendarEventUid` via task 1's deterministic-ID path); keep staff-only and practice-only guards.
  - Surface the attendance panel for these events in `apps/app/src/pages/ScheduleEventDetail.tsx`.
  - Tests: unit test that a calendar practice event loads/saves attendance; regression test that the old "attendance opens after this event is tracked" block is gone for calendar practices.
  - _Requirements: 4.1_

- [ ] 3. Remove client-side session fuzzy matching for writes
  - Delete nearest-date matching from the write path; `resolvePracticeSessionForEvent` remains read-only display fallback, exact-ID and `masterId__` prefix matches only.
  - Tests: unit test that a recurring occurrence never writes attendance to a different occurrence's session.
  - _Requirements: 4.3_

- [ ] 4. Make the schedule render before calendar fetches complete
  - Restructure `loadParentSchedule` / `buildTeamSchedule` so DB events return immediately and ICS-derived events merge via a second async emission consumed by `Schedule.tsx` and `homeService.ts`; cap the client proxy fallback chain at one proxy.
  - Tests: unit test that first emission contains DB events with no `fetchAndParseCalendar` call awaited; test merged second emission dedups tracked UIDs; smoke test that schedule boots with an unreachable calendar URL configured.
  - _Requirements: 3.2, UX 1_

- [ ] 5. Use windowed `:runQuery` in the native REST fallback
  - Replace full-collection `nativeListScheduleEventDocuments`/`nativeListCollection` fallbacks for `games` and `practiceSessions` with structuredQuery date-range filters posted to the team parent path (`/documents/teams/{teamId}:runQuery`, or equivalent parent-scoped endpoint), not the root `/documents:runQuery`. Extend or wrap the existing `nativeRunQuery` helper to support parent paths plus range operators.
  - Tests: unit tests asserting the structuredQuery payload shape (parent path, collection, field filters, date bounds) for both collections.
  - _Requirements: 3.3_

- [ ] 6. Prune redundant reads in scope resolution
  - Skip per-player validation reads for inactive teams in `resolveParentScheduleChildren`; thread the already-loaded team doc into `buildTeamSchedule` to remove the duplicate team read.
  - Tests: unit test with a mocked inactive team asserting zero player reads; test that `buildTeamSchedule` performs one team read per team per load.
  - _Requirements: 3.4_

## Phase 2 — Server-side calendar sync and canonical events

- [ ] 7. Create `functions/calendar-sync-core.cjs` (pure reconcile module)
  - Implement parse → RRULE horizon expansion (past 30d / future 12mo, RECURRENCE-ID exceptions) → tracking-id computation matching `getCalendarEventTrackingId(event)` → diff (create / allowlist patch / cancel-on-missing with `missingCount` / un-cancel / guarded delete) → batched write plan. Deterministic doc IDs `ics-{urlHash8}-{trackingKey}` with tracking-id sanitization; `calendarEventUid` stores the tracking id (raw UID only for non-recurring events, occurrence id for recurring instances); adoption of legacy docs via `calendarEventUid` lookup; invalid/empty ICS rejection leaves docs untouched.
  - Tests (fixture ICS files in `tests/unit/`): each diff branch; app-owned fields preserved on patch; recurring occurrences store distinct tracking IDs in `calendarEventUid`; two teams sharing one feed stay namespaced; truncated feed causes zero writes.
  - _Requirements: 2.1–2.9, 1.6_

- [ ] 8. Add the `syncTeamCalendars` scheduled function
  - `functions.pubsub.schedule('every 60 minutes')`, 300s timeout: sweep teams with `calendarUrls`, conditional fetch (ETag/If-Modified-Since + `contentHash`) via the guarded fetch implementation currently inline in `exports.fetchCalendarIcs` (`normalizeTargetUrl`, `fetchWithTimeout`, `BEGIN:VCALENDAR` validation) plus the `calendar-ics-fetch-core.cjs` cache helpers, run the reconcile core, persist `calendarSyncs/{urlHash}` state (`lastFetchedAt`, `lastSuccessAt`, `etag`, `contentHash`, `lastError`, `lastRunCounts`) and `syncStatus/global.lastSweepAt`. Per-calendar try/catch isolation.
  - Tests: extend `tests/unit/functions-deployable-exports.test.js` for the new export (no `_internal` collision); unit tests for conditional-fetch skip and per-calendar failure isolation.
  - _Requirements: 1.1, 1.2, 1.5, 6.2, 6.3_

- [ ] 9. Add the `syncTeamCalendarNow` callable and client staleness trigger
  - Callable validates team-staff auth, syncs one (teamId, calendarUrl). App: on schedule open, if `calendarSyncs.lastFetchedAt` > 15 min old, fire-and-forget the callable; "Sync now" button in team calendar settings calls it with `forceRefresh`.
  - Tests: callable rejects non-staff; client trigger fires only when stale and never blocks or fails the schedule load.
  - _Requirements: 1.3, 1.4_

- [ ] 10. Firestore rules and indexes for sync state
  - `firestore.rules`: team staff may read `teams/{teamId}/calendarSyncs/*`; no client writes. Add any composite index needed for `games where calendarUrlHash ==` (verify against `firestore.indexes.json` single-field rules — avoid the known invalid-index deploy failure).
  - Tests: unit test asserting rules text includes the new match block; deploy-safety check for indexes file.
  - _Requirements: 6.1, 1.5_

- [ ] 11. Calendar sync status UI in team settings
  - Show "last synced X ago" / "failing since Y — {lastError}" from `calendarSyncs` next to each calendar URL in the app team settings, with the Sync now button (task 9).
  - Tests: component test for fresh, stale, and failing states.
  - _Requirements: 6.1_

- [ ] 12. Remove the client ICS fetch from the React app load path
  - When every `calendarUrls` entry for a team has a `calendarSyncs` doc with a successful sync, skip `fetchAndParseCalendar` entirely in `buildTeamSchedule` (synced docs arrive via the normal games query; existing `isTrackedCalendarEvent` suppression covers the transition).
  - Tests: unit test that no calendar fetch occurs when sync state is present and healthy; events appear exactly once.
  - _Requirements: 3.1, 5.1, 5.2_

- [ ] 13. Migration: re-link orphan ICS-UID practice sessions
  - `_migration/relink-calendar-practice-sessions.js` (Admin SDK, dry-run default): for each session whose `eventId` matches no game doc, link to the synced doc by `calendarEventUid`, else by the one-time heuristic (same team, start within 60s); report unmatched.
  - Tests: unit test the matching logic as a pure function with the audited production shapes (`madison-futsal-*@sniderfamily` style UIDs).
  - _Requirements: 4.4, 5.3_

- [ ] 14. Materialize in-app recurring practice occurrences
  - On series create/edit in `scheduleService.ts`, write occurrence docs (ID `masterId__YYYY-MM-DD`, `seriesId`, `instanceDate`) over the bounded horizon; remove `expandRecurrence` from read paths; `_migration/materialize-recurring-occurrences.js` backfills existing series (dry-run default). Keep occurrence-override/cancel flows writing to the occurrence docs.
  - Tests: create/edit produces expected docs; read path no longer calls `expandRecurrence`; occurrence cancel/override round-trips; migration dry-run output on fixture series.
  - _Requirements: 3.5_

- [ ] 15. Assert sync freshness in production smoke
  - `scheduled-prod-smoke` reads `syncStatus/global.lastSweepAt` and fails if older than 3 hours.
  - Tests: workflow-level check plus a unit test for the freshness comparator.
  - _Requirements: 6.2_

## Phase 3 — Denormalized summaries and cleanup

- [ ] 16. Trigger-maintained event summary fields
  - Firestore triggers on `rsvps`, `rideOffers`, `assignmentClaims` writes and session `attendance` updates maintain `rsvpSummary`, `rideshareSummary`, `openAssignmentCount`, `attendanceSummary` on the parent game doc (pure `*-core.cjs` module + thin trigger exports).
  - Tests: core-module unit tests per summary; deployable-exports test extended.
  - _Requirements: 3.6_

- [ ] 17. Drop list-view hydration fan-out
  - `loadParentSchedule` list views read summaries from event docs; `hydrateEventDetails` (rsvps/offers/claims subcollection reads) runs only for the event-detail screen.
  - Tests: unit test that list load performs zero subcollection reads; detail screen still hydrates.
  - _Requirements: 3.6, UX 1_

- [ ] 18. Live schedule updates via snapshot listeners
  - Replace pull-to-refresh full reloads with `onSnapshot` listeners on the windowed per-team games queries (web SDK path; native keeps timed refresh).
  - Tests: unit test listener wiring and teardown on unmount/team change.
  - _Requirements: 1.3 (freshness), UX 2_

- [ ] 19. Remove the client ICS fetch from legacy pages
  - Behind the same sync-health check as task 12, skip `fetchAndParseCalendar` in the six legacy consumers (team.html, calendar.html, family.html, parent-dashboard.html, edit-schedule.html, game-plan.html); retire the manual calendar import on edit-schedule.html in favor of "Sync now".
  - Tests: unit tests for page wiring changes; smoke specs for each page booting with a calendar-configured team.
  - _Requirements: 3.1, 5.2, 5.3_
