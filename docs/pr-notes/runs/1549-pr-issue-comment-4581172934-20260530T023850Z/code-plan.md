# Code Plan, PR #1549 Follow-up

## Minimal Patch Plan
- Add optional `checkoutAttemptToken` support to registration record creation.
- Generate one browser-side token per online checkout attempt.
- Forward the token through create/cancel checkout calls and Stripe return URLs.
- Normalize the token in Cloud Functions and include it in Stripe metadata.
- Gate checkout creation/reuse and capacity release on token equality for tokenized registrations.
- Allow the optional token in Firestore rules for public registration creates.

## Tests
- Add registration-flow unit coverage for token persistence and source wiring.
- Update Stripe service tests to assert full token-bearing payload forwarding.
- Run focused unit tests, Firebase rules validation, and diff check.

## Notes
- The code role timed out, so main execution completed the patch directly using the requirements, architecture, and QA role outputs.
