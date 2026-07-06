# Feature: Schedule Loading Redesign

## Introduction

Schedule loading in the ALL PLAYS app (`apps/app`) is slow and attendance marking is unreliable because the schedule is assembled client-side from four inconsistent sources: `teams/{teamId}/games` docs, recurring series masters expanded in the client into synthetic `masterId__YYYY-MM-DD` IDs, external ICS calendar events fetched live during every load, and orphan `practiceSessions` docs. Investigation of a real account (5 teams, 59 game docs, 3 external calendars) confirmed:

- Every schedule load fetches and parses external ICS feeds inline, with a fallback chain (Cloud Function → direct fetch → 4 CORS proxies, 5s timeout each) that can add ~30 seconds per dead feed.
- The native (Capacitor) read path falls back from the Firebase SDK (5s timeout per read) to REST calls that list entire collections and filter client-side.
- Attendance is blocked for calendar-imported practices (`isDbGame` guard), dead-ends on DB practices with no pre-created session ("not linked to a session yet"), and uses nearest-date fuzzy matching that can attach attendance to the wrong recurring occurrence. Production data contains orphaned sessions keyed by ICS UIDs (e.g. `madison-futsal-winter2-5@sniderfamily`) that the app can no longer reach.

This feature moves calendar data server-side (a scheduled Cloud Function syncs ICS feeds into Firestore event docs), removes the client ICS fetch from the load path, makes every visible schedule event a real Firestore doc, and makes attendance work uniformly across all practice sources. Both the legacy site and the React app read the same collections and already suppress client-fetched ICS events when a doc with a matching `calendarEventUid` exists, so the sync is backward compatible with both clients by design.

## User Stories

1. As a parent, I want the schedule screen to render immediately from the database, so that I am not blocked by slow or dead external calendar feeds.
2. As a coach, I want to mark attendance on any practice — created in-app, recurring, or imported from a calendar — so that I do not have to know where an event came from.
3. As a coach, I want edits to my team's external calendar (add / move / cancel a practice) to appear in everyone's app automatically, so that I only maintain the schedule in one place.
4. As a coach, I want attendance, RSVPs, and packets to stay attached to a practice when its time changes in the external calendar, so that history is never orphaned.
5. As a team admin, I want to see when a calendar feed last synced and whether it is failing, so that a broken feed is visible to the person who can fix it instead of silently degrading everyone's schedule.
6. As a user of the legacy site, I want synced calendar events to appear exactly once (no duplicates alongside client-fetched ICS events), so that both apps stay consistent during the transition.

## Requirements (EARS)

### 1. Server-side calendar sync

1.1. WHEN the scheduled sync job runs (Cloud Scheduler, every 60 minutes), THE SYSTEM SHALL iterate all teams with non-empty `calendarUrls` and reconcile each feed into Firestore event docs.

1.2. WHEN fetching a feed, THE SYSTEM SHALL use conditional requests (`ETag` / `If-Modified-Since`) and a stored content hash, and SHALL skip reconciliation when the feed is unchanged.

1.3. WHEN a user opens the schedule and a team calendar's `lastFetchedAt` is older than a staleness threshold (default 15 minutes), THE SYSTEM SHALL trigger an on-demand sync for that calendar in the background without blocking rendering.

1.4. WHEN a team admin taps "Sync now" in calendar settings, THE SYSTEM SHALL sync that calendar immediately (`forceRefresh` semantics).

1.5. THE SYSTEM SHALL persist per-calendar sync state in a `calendarSyncs` document: `lastFetchedAt`, `etag`, `contentHash`, `lastError`, `lastSuccessAt`.

1.6. THE SYSTEM SHALL reuse the existing server-side fetch core (`functions/calendar-ics-fetch-core.cjs` SSRF guards, ICS validation) for all sync fetches.

### 2. Reconciliation semantics

2.1. THE SYSTEM SHALL use the ICS `UID` (plus `RECURRENCE-ID` for exceptions) as event identity, with a deterministic Firestore doc ID derived from the calendar URL hash and UID.

2.2. WHEN a new UID appears in a feed, THE SYSTEM SHALL create an event doc with `source: 'calendar'`, `calendarEventUid`, and the feed's `SEQUENCE`/`DTSTAMP` as `sourceRevision`.

2.3. WHEN an existing UID's content changes, THE SYSTEM SHALL patch only source-owned fields (date, end, location, title/summary, cancelled status) and SHALL NOT modify app-owned fields (`statTrackerConfigId`, `arrivalTime`, `notes`, `kitColor`, assignments, `gamePlan`).

2.4. WHEN an event's date or time changes in the feed, THE SYSTEM SHALL update the existing doc in place so attendance, RSVPs, and practice sessions remain attached.

2.5. WHEN a UID disappears from a feed, THE SYSTEM SHALL mark the event doc `status: 'cancelled'` with `cancelReason: 'removed-from-calendar'` and SHALL NOT delete it. Hard deletion MAY occur only for future events with no attached data (no RSVPs, sessions, or attendance) after 3 consecutive syncs missing.

2.6. WHEN a feed event carries `STATUS:CANCELLED` or a `[CANCELED]` summary marker, THE SYSTEM SHALL mark the event doc cancelled.

2.7. WHEN a feed event has an `RRULE`, THE SYSTEM SHALL expand occurrences server-side within a bounded horizon (past 30 days to future 12 months) into occurrence docs keyed `uid__instanceDate`, applying `RECURRENCE-ID` exceptions as per-occurrence patches, and SHALL roll the horizon forward on each scheduled run.

2.8. WHEN a game doc already exists with `calendarEventUid` equal to a feed UID (e.g. created by the legacy manual import), THE SYSTEM SHALL patch that doc rather than creating a duplicate.

2.9. WHEN a feed returns invalid or empty ICS, THE SYSTEM SHALL record the error on the `calendarSyncs` doc and SHALL leave all previously synced event docs untouched.

### 3. Schedule load performance

3.1. THE SYSTEM SHALL NOT fetch or parse ICS feeds in the client schedule load path (`buildTeamSchedule` in `apps/app/src/lib/scheduleService.ts`) once server sync is live for a team.

3.2. WHILE server sync is not yet live (Phase 1), THE SYSTEM SHALL render database events immediately and merge client-fetched calendar events asynchronously after first paint.

3.3. WHEN the native (Capacitor) runtime falls back to Firestore REST, THE SYSTEM SHALL use `:runQuery` with date-range filters instead of listing entire collections.

3.4. THE SYSTEM SHALL skip inactive teams before performing per-player validation reads in `resolveParentScheduleChildren`, and SHALL NOT read the same team document twice per load.

3.5. WHEN recurring in-app practice series are created or edited (Phase 2), THE SYSTEM SHALL materialize occurrence docs within a bounded horizon instead of expanding recurrence client-side with synthetic IDs.

3.6. THE SYSTEM SHALL denormalize per-event summary fields (`attendanceSummary`, `rideshareSummary`, `openAssignmentCount`, in addition to the existing `rsvpSummary`) onto event docs via Firestore triggers (Phase 3), so that the schedule list view requires zero subcollection reads.

### 4. Attendance on all practice events

4.1. WHEN a staff member opens attendance for any practice event backed by a Firestore doc, THE SYSTEM SHALL allow marking attendance regardless of the event's origin (in-app, recurring occurrence, or calendar sync).

4.2. WHEN attendance is first marked for a practice with no linked session, THE SYSTEM SHALL create the practice session automatically using a deterministic session ID equal to the event ID, via an idempotent merge write (no query-then-create race).

4.3. THE SYSTEM SHALL resolve practice sessions by exact event ID only, and SHALL NOT use nearest-date fuzzy matching for new writes.

4.4. WHEN migrating (Phase 2), THE SYSTEM SHALL re-link existing orphan practice sessions whose `eventId` is an ICS UID to the corresponding synced event docs, preserving recorded attendance.

### 5. Backward compatibility (legacy site + React app)

5.1. THE SYSTEM SHALL stamp every synced event doc with `calendarEventUid` so the existing suppression logic in both clients (legacy `js/calendar-ics-sync.js` merge; app `isTrackedCalendarEvent`) hides duplicate client-fetched ICS events without client changes.

5.2. WHEN the sync is live, events synced from calendars SHALL appear exactly once in both the legacy site and the React app.

5.3. THE SYSTEM SHALL leave the legacy manual "import from calendar" flow functional during transition; docs it creates SHALL be recognized by the sync via `calendarEventUid` (see 2.8).

### 6. Observability and failure visibility

6.1. WHEN a calendar sync fails, THE SYSTEM SHALL surface "last synced X ago / failing since Y" to team admins in calendar settings, and SHALL NOT degrade schedule rendering for any user.

6.2. THE SYSTEM SHALL stamp a global `lastSweepAt` timestamp on each scheduled run, and the production smoke workflow SHALL assert its freshness so a broken deploy is a red check rather than silently stale schedules.

6.3. THE SYSTEM SHALL record sync outcomes (created / updated / cancelled counts, duration) per run for debugging.

## Edge Cases

1. A feed temporarily serves truncated or empty content during a host outage — cancel-don't-delete (2.5) plus invalid-ICS rejection (2.9) prevent data loss.
2. Two teams import the same external calendar — doc IDs are namespaced by calendar URL hash per team, so events sync independently per team.
3. An ICS event moves across the recurrence horizon boundary — the rolling horizon (2.7) picks it up on the next scheduled run.
4. A coach edits an app-owned field on a synced event, then the feed changes the same event — source-owned/app-owned field split (2.3) preserves the coach's edit.
5. A user opens the schedule while an on-demand sync is running — the client renders last-known-good docs; snapshot listeners (Phase 3) or the next refresh pick up changes.
6. Feed UIDs are unstable (some providers regenerate UIDs) — treated as remove + add; cancelled originals retain history, and the migration heuristic (same team, same start time within 60s) MAY link replacements once.
7. The Cloud Scheduler job stops running after a failed deploy — smoke freshness check (6.2) turns red.

## UX Constraints

1. Schedule first paint MUST NOT wait on any external network fetch other than Firestore.
2. Worst-case calendar staleness is the scheduler interval (60 minutes); user-visible staleness after pull-to-refresh MUST be seconds, not minutes.
3. Attendance marking MUST never show "not linked to a session yet" or "attendance opens after this event is tracked" for any practice visible in the schedule (once Phase 2 is complete).
4. No breaking changes to RSVPs, ride shares, lineups, or live tracking flows.

## Success Criteria

1. Cold schedule load for a multi-team account with external calendars completes without any client-side ICS fetch (Phase 2) and renders first content in under 2 seconds on a warm connection.
2. Attendance can be marked on 100% of practice events visible in the schedule, including calendar-imported and recurring occurrences.
3. A calendar edit (add / move / cancel) propagates to all users within 60 minutes automatically and within seconds on manual refresh.
4. Zero duplicate events across legacy and React app during and after rollout.
5. Existing orphan ICS-UID sessions are re-linked with attendance history intact.

## Phasing

1. **Phase 1 (client-only quick wins):** async calendar merge after first paint (3.2), native REST `runQuery` windows (3.3), inactive-team and duplicate-read elimination (3.4), auto-create session on attendance mark (4.2), attendance for calendar practices keyed by `calendarEventUid`.
2. **Phase 2 (server sync + canonical events):** scheduled + on-demand + manual sync (§1, §2), materialized recurring occurrences (3.5), orphan session migration (4.4), remove client ICS fetch from the React app load path (3.1).
3. **Phase 3 (denormalized summaries):** trigger-maintained summary fields (3.6), snapshot listeners for live updates, remove client ICS fetch from legacy pages.
