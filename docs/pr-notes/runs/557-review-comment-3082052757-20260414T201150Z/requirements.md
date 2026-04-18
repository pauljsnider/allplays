## Objective
Define the minimum regression requirements for `test-track-zero-stat-player-history.js` so it catches the case-sensitivity bug Amazon Q identified, while matching the current aggregated-stats behavior in `track.html`.

## Acceptance Criteria
1. The regression test must verify that every rostered player is included in the aggregated player-history output, even when that player recorded no in-game stats.
2. The regression test must verify that a zero-stat player receives a stats object containing each configured stat column from the tracker, with each configured stat saved as `0`.
3. The regression test must verify that when configured columns and recorded stat keys use different letter casing, the saved player-history stats preserve the correct numeric values instead of falling back to zero.
4. The regression test must verify that the normalized saved stat keys match `track.html` behavior by using a single lowercase key per configured stat, without duplicate mixed-case variants.

## User/Coach Impact
- Coaches can trust post-game history to include bench or scoreless players instead of silently dropping them.
- Coaches and parents see correct stat totals in player history even if stat keys were entered or configured with inconsistent casing.
- Admins get more reliable regression protection for a high-pressure game workflow without changing the intended tracker behavior.

## Assumptions
- `track.html` is the source of truth for the expected aggregated-stats shape.
- Configured stat columns are intended to be persisted under lowercase keys in aggregated player-history data.
- This fix is limited to protecting the existing behavior, not redefining stat-storage rules.

## Out of Scope
- Changing the production aggregation logic in `track.html`.
- Expanding this test to unrelated tracker flows, Firestore wiring, or UI rendering.
- Broadening coverage for unrelated stat-shape behavior beyond the specific zero-stat and case-normalization regression.
