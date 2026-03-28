# Requirements role notes

Objective: Remediate unresolved PR #178 review feedback in `js/native-standings.js` only.

Feedback requirements:
1. Tiebreaker `head_to_head` must evaluate only completed/final games, matching the same subset used for standings totals.
2. Game rows with missing/unknown status must not count toward standings, even when scores are numeric.

Acceptance criteria:
- `computeNativeStandings` ignores any game where normalized status is not explicitly `completed` or `final`.
- Tiebreakers receive the same status-filtered game list used in table aggregation.
- Existing standings behavior remains unchanged for valid completed/final rows.
