## Objective

Define the minimum safe behavior for fixing `track.html` finish-game saves so a coach can complete a game even when total Firestore writes for finalization exceed the single-batch 500-write limit, without changing the expected completed-game experience for coaches, parents, or admins.

## Acceptance Criteria

1. **Large-write games can still be finished successfully.**  
   A coach can finish a game from `track.html` in a scenario where the combined finalization writes exceed 500 total writes, including:
   - all logged game events,
   - the completed game record update,
   - aggregated stats for every rostered player.

2. **The coach only sees success after all required finish-game saves succeed.**  
   The app must not redirect away from the tracker or behave as if the game is finished until all required finish-game data has been saved successfully.

3. **Failure remains recoverable for the coach.**  
   If any part of the finish flow fails, the coach stays on the current page, sees a clear error, and can retry finishing the game without re-entering the entire game from scratch.

4. **Completed-game data remains intact and consistent for end users.**  
   After a successful finish:
   - final score is correct,
   - summary is preserved,
   - all intended game events are available,
   - every rostered player has the expected aggregated stats entry,
   - opponent stats remain preserved.

5. **Existing normal-size games still work the same way.**  
   For games that do not approach the 500-write limit, the finish flow still behaves as before from the coach’s point of view.

6. **Parent and admin views are not degraded by the fix.**  
   After a successful finish, parents and admins viewing the completed game see the same final score and player stat outcomes they would expect today, with no missing players caused by roster size.

7. **Retrying a failed finish does not create visible duplicate completed-game data.**  
   A coach retrying after a failed finish must not end up with duplicate visible results such as duplicated player aggregates or a broken completed-game view.

## User/Coach Impact

- **Coach:** Must be able to finish the game quickly and reliably at the end of play, even for large rosters or long games, without hitting a technical Firestore limit.
- **Parents:** Must see a trustworthy completed game with the correct score and player stats once the coach finishes.
- **Admins/Program staff:** Must not have to clean up missing or inconsistent completed-game records caused by large-game finalization.

## Assumptions

- Firestore’s 500-write limit applies per batch/commit, and the safe fix may use more than one commit.
- A fully atomic single-commit finish is not required for this remediation, as long as the UI does not report success before all required writes succeed.
- The minimum safe fix should preserve the current user-facing workflow and not require coaches to change how they track or finish games.
- Manual validation is acceptable for this PR, including at least one scenario that exceeds 500 total finalization writes.

## Out of Scope

- Redesigning how live tracking works during the game.
- Reworking the data model for events or aggregated stats beyond what is needed for safe finalization.
- Backfilling or repairing old completed games.
- Broader performance optimizations unrelated to preventing the finish-game write-limit failure.
- Changes to parent-facing or admin-facing UX beyond preserving current expected behavior.
