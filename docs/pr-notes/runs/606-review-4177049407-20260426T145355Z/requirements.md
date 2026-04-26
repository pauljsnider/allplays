# Requirements Role Artifact

## Objective
Fix tournament advancement for division-scoped pools where the standings key is `Division • Pool`, but bracket slot assignments store only `poolName` and `seed` while `divisionName` lives on `game.tournament`.

## User Impact
- Coaches need finalized standings to advance into bracket slots without manual repair on tournament day.
- Parents need bracket matchups to match visible standings and not cross divisions.
- Program managers need same-named pools isolated across divisions.

## Acceptance Criteria
1. Advancing `10U Gold • Pool A` finds bracket slots whose game has `tournament.divisionName = 10U Gold` and whose slot has `poolName = Pool A`.
2. Required seeds are collected from the matching division and pool only.
3. `10U Gold • Pool A` does not collect or resolve slots from `12U Silver • Pool A`.
4. Legacy unscoped pools still match by plain `Pool A`.
5. Existing preview and overwrite confirmation behavior remains intact.
6. Missing division, pool, ranking, or seed data fails safely through existing skipped-plan paths.

## Assumptions
- Division is tournament-level context.
- Pool and seed are slot-level context.
- No Firestore data migration is needed.
