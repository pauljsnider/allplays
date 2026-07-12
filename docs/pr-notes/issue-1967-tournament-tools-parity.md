# Issue #1967: Tournament Tools Parity

Status as of 2026-07-12: split-parent closeout map. The implementation
slices for app schedule tournament tools are present on `master`; the parent
issue should close only after the live web/app matrix below is executed on a
disposable Firestore-backed team and the evidence is posted back to #1967.

This document is intentionally narrow. It covers app schedule tournament tools,
the related legacy schedule contract, and the focused unit/smoke checks that
prove the current implementation. It does not expand scope into organization
scheduling, advanced bracket editing, or tournament administration beyond the
schedule page.

## Automated Acceptance Map

| Parent requirement | Current in-repo proof | What the proof covers |
| --- | --- | --- |
| Web-created tournament groupings render in the app schedule. | `apps/app/src/pages/Schedule.test.tsx` renders web-created tournament metadata; `tests/unit/app-schedule-tournament-info.test.ts` covers labels, details, slot assignments, and standings display. | App list/detail consumers read `competitionType: tournament`, division, bracket, round, pool, bracket positions, slot sources, and inline standings without requiring staff access. |
| Tournament standings display read-only and match the legacy calculation. | `apps/app/src/lib/scheduleService.test.ts` has the `web-created tournament standings hydration (#1967)` suite; `apps/app/src/lib/adapters/legacyTournamentStandings.ts` adapts `js/tournament-standings.js`. | The app computes standings from complete tournament pools, honors team standings config and `tournamentPoolOverrides`, preserves inline standings priority, and handles native bounded reads. |
| Staff can create a basic tournament block natively. | `apps/app/src/pages/Schedule.test.tsx` covers add/remove game rows, indexed validation, successful submit, reload rendering, failure retention, and non-staff gating. | Staff can enter tournament metadata and one or more child games from Schedule tools; invalid rows block submit without clearing the draft. Parents still see tournament context read-only. |
| Created tournament games use the legacy-compatible game document shape. | `apps/app/src/lib/scheduleService.test.ts` covers `createScheduledTournamentBlockForApp`; `apps/app/src/lib/adapters/legacyScheduleDb.test.ts` covers `buildLegacyTournamentGameDocuments`. | Each child game is persisted through the normal game save path with `competitionType: tournament` and `tournament.divisionName`, `tournament.bracketName`, `tournament.roundName`, and optional `tournament.poolName`. Partial multi-game failures surface `TournamentBlockPartialSaveError` with safe retry guidance. |
| Tournament games behave as ordinary games. | `tests/smoke/app-schedule.spec.js` has `tournament game keeps RSVP, tracking, finalization, and reports on the shared game lifecycle`. | A tournament game can use parent RSVP, Standard Tracker stat entry, post-game wrap-up/finalization, and report sections through the shared game route and identifiers. |
| The mobile create flow remains usable. | `tests/smoke/app-schedule.spec.js` has `iOS-sized staff schedule submits every row in a multi-game tournament block`. | A 390 x 844 viewport can open staff tools, create a two-row tournament block, submit all rows, refresh, and avoid horizontal overflow. |

Automated checks are necessary but not sufficient for closing #1967 because
they use fixtures and mocked service surfaces for the end-to-end UI proof.

## Cross-Surface Closeout Matrix

Run this matrix against a disposable team in the target Firebase project. Record
the team ID, app build or preview URL, legacy web URL, tester role, created game
IDs, and screenshots or short clips for each pass. Clean up the disposable
tournament data afterward.

### 1. Web-created tournament -> app render and update

1. Sign in as a coach or admin.
2. Open `edit-schedule.html#teamId={teamId}`.
3. Create or identify a tournament with a unique QA label, for example
   `QA 1967 Gold`, with at least two games in the same division/pool.
4. Confirm the game documents under `teams/{teamId}/games/{gameId}` include
   `competitionType: tournament` and the expected `tournament` fields.
5. Open the app Schedule route as a coach and as a parent.
6. Verify the app shows grouping name, member games, round/bracket context,
   bracket position or slot source where present, and computed or stored
   standings.
7. Advance or update a round/result on the web, refresh the app, and verify the
   app reflects the updated tournament context and standings.

Pass criteria: the app read model matches the legacy tournament state and
parent users do not see native create/manage controls.

### 2. App-created multi-game block -> legacy web render

1. Sign in to the app as a coach or admin.
2. Open Schedule, expand Manage schedule, and start a new tournament block.
3. Enter division, bracket, round, optional pool, and at least two child games.
4. Submit the block and wait for `Tournament created and schedule refreshed.`.
5. Confirm each saved document under `teams/{teamId}/games/{gameId}` uses the
   ordinary game fields plus `competitionType: tournament` and the shared
   tournament metadata.
6. Open `edit-schedule.html#teamId={teamId}` and verify the new games render
   with the same tournament metadata and are usable by the legacy tournament
   views.

Pass criteria: every app-created child game round-trips through the legacy web
schedule without schema repair or manual data edits.

### 3. Tournament game lifecycle

1. Sign in as a parent and open one tournament game in the app.
2. Submit RSVP for a linked player.
3. Sign in as coach/admin and open the same game through the app Game hub.
4. Launch tracking, record at least one stat, finalize the game, and open report
   sections.
5. Open the corresponding legacy `game.html` or live game/report route and
   verify the same team/game identity, score, stat/report data, and tournament
   context.
6. Refresh Schedule in the app and verify standings update when the completed
   score affects the tournament pool.

Pass criteria: RSVP, tracking, finalization, reports, and standings remain on
the shared game lifecycle with no tournament-specific fork.

### 4. Failed multi-game save recovery

1. Use a preview or disposable environment where a save fault can be injected
   after the first tournament child game write.
2. Submit a valid multi-game tournament block.
3. Verify the app surfaces the partial-save guidance, preserves the attempted
   draft, and does not silently report success.
4. Refresh Schedule before retrying, then verify no duplicate child games are
   created by the recovery path.

Pass criteria: a failed multi-game save is explicit, recoverable, and does not
hide partial persistence from the coach.

## Closure Rule

Do not close #1967 from mocked automation alone. Close the parent only after:

- The focused unit, app build, and tournament smoke commands pass.
- The live web-created-to-app and app-created-to-web matrix passes on a
  disposable Firestore-backed team.
- Parent RSVP, coach tracking/finalization, report rendering, and refreshed
  standings are verified on the same tournament game.
- Failed multi-game save recovery is verified with fault injection or an
  equivalent documented disposable-environment result.

Suggested issue closeout comment:

```markdown
## #1967 closeout

- Team / environment:
- Web-created tournament -> app render/update: pass, evidence:
- App-created multi-game tournament -> web render: pass, evidence:
- RSVP/tracking/finalization/report/standings: pass, evidence:
- Failed multi-game save recovery: pass, evidence:
- Automated checks:
  - `npx vitest run tests/unit/issue-1967-schedule-tournament-tools-source.test.js tests/unit/app-schedule-tournament-info.test.ts --reporter=verbose`
  - `npm --prefix apps/app run test:ci -- --runInBand` or focused app schedule suites
  - `npm run app:build`
  - `SMOKE_APP_BASE_URL={preview} npx playwright test --config=playwright.smoke.config.js tests/smoke/app-schedule.spec.js --grep "tournament"`
```
