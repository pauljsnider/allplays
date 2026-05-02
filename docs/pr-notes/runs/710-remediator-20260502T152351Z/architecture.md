# Architecture notes

## Current state
- The webhook verifies Stripe signatures, but `shouldUnlockTeamPassFromEvent` allowed any paid `checkout.session.completed` event through to entitlement building.
- Non-Team-Pass checkout sessions could throw on missing Team Pass metadata and trigger Stripe retries.
- The public webhook had no request throttling before expensive Stripe and Firestore work.

## Decisions
- Gate unlock eligibility on both paid completed checkout status and valid Team Pass metadata.
- Keep `buildTeamPassEntitlement` strict so malformed Team Pass events still fail before writing bad entitlement data.
- Add a small in-memory, per-instance rate limiter before Stripe config/client work. This is intentionally scoped and code-only.

## Risk and rollback
- In-memory throttling resets on cold start and is per instance, so it is not a global WAF. It still reduces single-instance abuse and satisfies the minimal review concern without external infrastructure.
- Legitimate bursts may receive 429. Stripe retries webhook deliveries, and the threshold is conservative.
- Rollback is code-only. No schema or data migration required.
