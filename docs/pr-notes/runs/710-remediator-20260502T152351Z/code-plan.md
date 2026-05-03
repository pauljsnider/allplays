# Code plan notes

## Files
- `functions/team-pass-core.cjs`: add a metadata/provenance guard and require it in `shouldUnlockTeamPassFromEvent`.
- `functions/rate-limit.cjs`: add a small reusable in-memory rate limiter for the public webhook endpoint.
- `functions/index.js`: apply the limiter at the top of `stripeTeamPassWebhook` after method validation and before Stripe config/client work.
- `tests/unit/team-pass-functions.test.js`: add focused coverage for the metadata guard and rate limiter.

## Implementation plan
1. Keep checkout creation metadata unchanged.
2. Add `hasTeamPassMetadata` using the existing checkout input normalization plus required `purchaserUid`.
3. Return `false` from the unlock gate for unrelated paid sessions so the webhook acknowledges and ignores them.
4. Return HTTP 429 with `Retry-After` when the webhook rate limit is exceeded.
5. Run the focused Vitest file and commit all changes.
