# Architecture Notes

## Root cause
The Firestore rules already grant scoped scorekeeper game updates through `isScorekeepingGameUpdate(teamId, gameId)`, but the unit test asserts an exact single-line `allow update` rule that predates the additional official-game update path.

## Minimal safe decision
Keep the production rule unchanged. Update the wiring test to assert the effective access predicates are present in the games update rule instead of requiring the outdated exact line.

## Risk and blast radius
Blast radius is limited to test code. No runtime behavior or Firestore access control changes are introduced.

## Rollback
Revert the test assertion change if the rules contract changes back to a single owner/admin plus scorekeeper predicate.
