# QA notes

## Automated validation
- Run the focused Team Pass helper tests: `npm test -- tests/unit/team-pass-functions.test.js`.
- Verify valid Team Pass paid completed sessions still unlock.
- Verify unrelated paid checkout sessions return false from the unlock gate.
- Verify missing `purchaserUid` returns false from the unlock gate.
- Verify rate limiting allows requests within threshold, rejects over-threshold requests, and resets after the window.

## Manual validation if deployed
- Send a signed Stripe webhook for a valid Team Pass checkout and confirm `200 { received: true, unlocked: true }` plus entitlement write.
- Send a signed unrelated paid checkout session and confirm `200 { received: true, unlocked: false }` with no entitlement write.
- Send repeated webhook requests from one source and confirm over-threshold requests receive HTTP 429 with `Retry-After`.
