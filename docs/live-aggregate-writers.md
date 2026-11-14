# Classic live aggregate writer contract

Inventory for overlay PR5127. `aggregatedStats` is public; `privatePlayerStats`
remains separately permissioned. Both carry `liveStatsVersion: 1` and the
canonical game reset epoch. Readers never add stored totals to event sums.

| Active writer | Boundary |
| --- | --- |
| `track.html`, `track-basketball.js` finish | `commitStandardTrackerFinishData`: original session epoch checked per transaction chunk; public/private split and tags; private hydration before reopen |
| `track-live.html` delayed sync/finish | `persistPlayerStatsForEpoch` splits visibility; `persistLiveAggregateSnapshot` checks game epoch and existing rows, stamps both collections |
| `live-tracker.js` delayed sync/finish/retry | Visibility split plus private hydration; same persistence helper. Persisted finish plans retain original epoch; missing epochs fail closed |
| `live-tracker-finish.js` / `live-tracker-save-complete.js` | Plan builder tags both maps; generic batch adapter is consumed by the guarded live-finish path or transactional statsheet import |
| `db.js:updatePlayerStats` | Public and private increments read game and row in a transaction, reject ambiguous history, and stamp current epoch |
| `db.js:setCompletedGamePlayerStats`, `game.html` | Editor passes loaded epoch; transaction replaces public/private maps together; stale editor rejected |
| `statTrackingService.ts` | Shared React/Capacitor stat/undo increments transact game plus relevant public/private rows; visibility split preserved |
| `scheduleService.ts` | Web transactions and native REST preconditioned commits bind game/row revisions and tag public totals. Undo also validates original event epoch. Public quick controls reject configured-private metrics and direct users to the full tracker; configuration is read in the web transaction or bound by native verify precondition |
| `track-statsheet.html` | Resolved configuration splits public/private imported values; one epoch-checked replacement transaction publishes a new epoch, rows and game metadata |
| `statsheetImportService.ts`, `legacyStatsheetImport.ts` | Shared React/Capacitor import uses same replacement transaction and resolves current configuration before upload/write |

Statsheet replacement deliberately establishes a new epoch. Older trackers cannot
reapply their saved totals. Retained old rows do not become current totals merely
because cleanup's initial collection read missed a concurrent row. Existing
append-only live events are retained; no permission or security-rule changes.

Diamond projector writes use `diamondStatGenerations/{instanceId}` and its own
revision protocol; classic viewers route away before subscribing. Account/game
deletion and Diamond compatibility cleanup are deletions, not classic aggregate
producers. These boundaries are not migrated by this feature.

A nonempty untagged row after a reset has an unknown epoch. Ordinary incremental
or snapshot writes refuse to silently reinterpret it. An explicitly reviewed
statsheet replacement or post-game edit may replace its selected totals while
checking the authoritative game epoch. No historical records are backfilled.

Finish and reset cleanup are bounded multi-transaction operations, not whole-game
atomic commits. Failure can leave partial prior-epoch cleanup. Statsheet import
retains its existing single-save write bound and commits its replacement atomically.
Tests use fixtures and injected transaction conflicts; emulator/physical-device
and production-session acceptance remain separate gates.
