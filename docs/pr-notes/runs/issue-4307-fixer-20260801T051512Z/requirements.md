# Requirements

## Objective

Add focused integration coverage proving that the protected co-parent callable, invitation persistence, and email trigger behave as one workflow consumed by the Player page.

## Acceptance contract

- A permitted request returns `id`, `code`, authoritative names, normalized email, `created: true`, and `reused: false`, then produces exactly one access-code and one mail record.
- An equivalent request for the same team, player, and normalized email returns the same invite with `created: false` and `reused: true`, without another record or quota reservation.
- A different request after sender capacity is exhausted rejects with `resource-exhausted` and retry details, without another access-code, mail, idempotency, or partial rate-limit record.
- The throttled outcome remains a rejected callable, matching the Player workflow; it is not a successful `{ throttled: true }` payload.

## Dependencies and scope

Dependencies #4305 and #4306 are present at the starting SHA `aaa6b1998d87b11093d05362e2c1218a6e0c4414`. The slice is test-only. Player UI, Firestore rules, other invite types, redemption, and membership grants remain out of scope.

## Root cause

Existing tests cover callable deduplication/throttling, the email trigger, deterministic mail IDs, and Player feedback separately. No shared-state test measures the combined durable result, so seam drift could create extra access-code or mail records while isolated suites remain green.
