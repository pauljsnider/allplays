# Practice & Recurring Schedule Design

## Current State (edit-schedule.html)
- Only creates/edits/deletes `teams/{teamId}/games/{gameId}` documents (fields: date, opponent, location, status, scores, statTrackerConfigId).
- Shows external calendar events (ICS) and tags any summary containing "practice/training/skills" via `isPracticeEvent`, but practices are not stored in Firestore.
- No end time for games; one datetime-local input; schedule list renders date/time and location only.
- AI bulk update only adds/updates/deletes games.

## Goals
- Allow practices as first-class events with start & end times.
- Create recurring practices (e.g., Tue/Thu 6–8pm) with series editing.
- Edit or cancel a single occurrence without killing the whole series.
- Keep games and stat tracking unchanged/backward compatible.

## Data Model (Firestore)
- Extend `teams/{teamId}/games/{gameId}` to be a generic event:
  - `type: 'game' | 'practice'` (default `game` for existing docs).
  - `title` (practice name; default "Practice").
  - `start` (Timestamp) and `end` (Timestamp); for legacy games, derive `end = start + 2h` for display if missing.
  - Game-only fields stay: `opponent`, `status`, `homeScore`, `awayScore`, `statTrackerConfigId`, `calendarEventUid`.
  - Recurrence (series master only): `recurrence: { freq: 'weekly' | 'daily', interval: 1, byDays: ['TU','TH'], until: Timestamp | null, count: number | null }`, `isSeriesMaster: true`, `seriesId` (UUID), `exDates: [ISO date strings]`, `overrides: { '<iso-date>': { start, end, location, title } }`.
  - Generated instances: not stored individually; occurrences are rendered client-side from master + overrides/exDates. Single-occasion overrides create an `overrides` entry instead of new doc.

## Security Rules
- Keep existing game rules, but treat practices the same as games for writes: owner/admin/global admin can create/update/delete; reads remain public.
- When `type == 'practice'`, still allow read; no stat writes are needed.
- Validate recurrence payload: freq in allowlist; byDays subset; until/count optional.

## DB API Changes (`js/db.js`)
- `getEvents(teamId, opts)` → returns combined list of game docs (type defaulting to `game`) and in-memory expanded practice occurrences:
  - Fetch `games` collection once; split masters by type/recurrence.
  - Expand recurrence to a window (e.g., next 120 days or until `until`), skipping `exDates` and applying `overrides`.
  - Output unified items `{ id, type, start, end, location, opponent, title, source: 'db', seriesId, isSeriesMaster, instanceDate }`.
- `addEvent(teamId, data)` → handles `type` and recurrence; when recurrence set, writes master doc only.
- `updateEvent(teamId, id, data, opts)`:
  - If `opts.scope === 'this'` on recurring: write into `overrides[isoDate]` or append to `exDates` for cancel; for practice, no new doc.
  - If `scope === 'series'`: update recurrence master.
- `cancelOccurrence(teamId, seriesId, isoDate)` helper → push into `exDates`.
- `normalizeGameDefaults(doc)` → backfill `type:'game'`, compute `end` fallback.
- AI helper reuse: ensure non-game ops set `type:'game'` to avoid misclassification.

## UI/UX (edit-schedule.html)
- Form becomes “Add Event” with Type toggle (Game/Practice).
  - Game fields: opponent, location, stat config (unchanged), start, end (end defaults +2h from start on blur).
  - Practice fields: title (default "Practice"), location, start, end, recurrence builder (frequency weekly/daily, interval, day-of-week multi-select, end condition count/date/none), notes (optional).
- Schedule list renders both games and practices:
  - Practice badge color; shows start–end time, title, location.
  - For recurring, show “Repeats Tue/Thu until May 1” text.
  - Actions: Edit (opens modal: choose This occurrence vs Entire series), Cancel occurrence, Delete series. Games keep Edit/Delete/Track.
- Single-occurrence edit flow: when selecting “This occurrence”, write override in master; when “Cancel this occurrence”, add to `exDates`.
- Recurrence generation window: show next N months (e.g., 6 months); include past 14 days for recent occurrences so cancellations are visible.
- AI tab (optional follow-up): keep game-only for now; ignore practices.

## Parsing/Display Helpers (`js/utils.js`)
- Add recurrence formatter (`formatRecurrence(recurrence)`) and `formatTimeRange(start,end)`.
- Expand recurrence utility (deterministic, no external deps): given master + window, return occurrences applying overrides/exDates. Support weekly/day-of-week and daily intervals; skip complex RRULEs.

## Backward Compatibility
- Existing game docs remain valid; they get `type: 'game'` and inferred `end` in UI. Other pages (`track.html`, `game.html`, stats) filter `type === 'game'` to avoid seeing practices.
- Public team pages continue to show games only unless explicitly showing practices.

## Testing Plan (manual)
- Add single practice with start/end; verify list shows range and respects Show Practices toggle.
- Create weekly Tue/Thu series for 4 weeks; verify 8 occurrences render; cancel one occurrence; edit one occurrence time/location; edit entire series end date and see future shrink.
- Ensure games still add/edit/delete, track works; practices don’t show on tracking/stat pages.
- Validate recurrence boundaries (until date, count) and that `exDates` hides cancelled dates.
