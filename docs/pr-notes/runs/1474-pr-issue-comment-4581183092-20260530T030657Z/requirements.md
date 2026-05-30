# Requirements Role

## Acceptance Criteria
- Empty scorer remains allowed and records a team-only goal.
- Non-empty scorer must resolve to the selected side's roster or opponent player by exact normalized name or jersey number before any score, log, live event, or stat mutation occurs.
- Valid home scorer increments the home score and the matching player `goals` stat.
- Valid away scorer increments the away score and the matching opponent player `goals` stat.
- Undoing a scored goal decrements the score and any attributed scorer `goals` stat without going below zero.
- Undo emits live state sufficient for parent/fan views to stop showing stale attribution.

## User Impact
- Coach/scorekeeper gets a fast path for team goals plus guardrails against fat-fingered scorer attribution.
- Parents/fans see live score and scorer attribution that match the game log.
- Program/admin reporting avoids inflated player goal totals after undo.

## Non-Goals
- Fuzzy matching.
- Post-hoc scorer edit workflows.
- Changes outside goal-sport live tracking.
