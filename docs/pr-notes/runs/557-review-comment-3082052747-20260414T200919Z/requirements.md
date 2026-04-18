## Objective

Define the minimum requirements for the PR #557 fix so `track.html` preserves configured stat values when player stat keys use mixed case, and so the regression test in `test-track-zero-stat-player-history.js` proves that behavior stays correct.

## Acceptance Criteria

1. When a coach finishes a game from `track.html`, each configured stat column is saved for every rostered player using the expected configured/lowercase output keys, even if the in-memory `playerStats` source uses mixed-case keys like `PTS`, `ReB`, or `ast`.

2. If a player has a recorded value for a configured stat under a mixed-case key, that saved value is not replaced with `0` in the aggregated stats written at game finish.

3. If a rostered player has no recorded stats, that player still receives an aggregated stats record with all configured stat columns present and set to `0`.

4. Any non-configured stat already present on a player remains preserved in the saved stats payload and is not dropped by the normalization for configured columns.

5. `test-track-zero-stat-player-history.js` includes regression coverage that fails if mixed-case configured stat keys are zeroed or duplicated during aggregated stats generation, and passes when the saved stats object contains the correct normalized configured keys with the original values intact.

## User/Coach Impact

- **Coach:** Post-game stats remain accurate when finishing a game, which avoids losing credited performance for players under time pressure.
- **Parent:** Player history and shared stat views reflect the real game output instead of showing false zeroes.
- **Admin/Program Manager:** Stored aggregated stats stay reliable for reporting, season summaries, and downstream views without manual cleanup.

## Assumptions

- Configured stat columns should continue to be stored under the existing normalized lowercase keys used by `track.html`.
- The bug scope is limited to aggregated stats written when finishing the game, not a broader redesign of stat-key handling across the app.
- The regression test file is the intended lightweight guardrail for this PR, since the repo does not use a full automated test framework.

## Out of Scope

- Changing the displayed column labels or tracker UI wording.
- Backfilling or migrating previously saved game data.
- Altering opponent stat handling, non-finish save flows, or unrelated stat normalization behavior elsewhere in the app.
- Adding broader test infrastructure beyond the targeted regression coverage in `test-track-zero-stat-player-history.js`.
