# Code Plan

## Minimal patch

Create only `functions/test/co-parent-invite-integration.test.cjs`. Compose production callable, trigger, eligibility, message, and mail-ID helpers over a deterministic shared Firestore harness. Do not change production code.

## Implementation sequence

1. Seed a linked parent, team, and player.
2. Implement transactional query/read/create/set behavior and committed access-code create events.
3. Pump only those create events through the real invite email trigger.
4. Persist mail through create-only semantics and the production deterministic ID.
5. Assert permitted, reused, and throttled contracts plus final collection counts and reservation state.
6. Run the focused integration test and adjacent callable-core test, inspect the diff, then commit.

## Prevention / learning

Protected mutations with asynchronous create triggers need one shared-state contract test covering first success, idempotent duplicate, and rejected/throttled mutation. Side-effect count must follow successful resource creation count, not request count.
