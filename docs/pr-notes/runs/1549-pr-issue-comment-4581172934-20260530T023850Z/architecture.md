# Architecture, PR #1549 Follow-up

## Architecture Decisions
- Use `checkoutAttemptToken` as a narrow concurrency guard for registration checkout attempts.
- Generate the token in `registration.html` before reservation creation.
- Store the token on the registration record only when provided by the checkout flow.
- Normalize and validate the token in callable functions.
- Include the token in Stripe registration metadata and server-generated return URLs.
- Require token equality before checkout reuse/creation and before capacity release for tokenized registrations.

## Data Flow
1. Browser creates `checkoutAttemptToken` for the pay attempt.
2. Browser writes the registration reservation with that token.
3. Browser calls `createStripeRegistrationCheckout` with the same token.
4. Callable validates the registration token before creating/reusing Stripe checkout.
5. Stripe metadata and cancel URL carry the token.
6. Browser cancel/no-URL/throw release calls include the token.
7. Server release decrements capacity only when the registration token matches.

## Blast Radius And Rollback
- Blast radius is one registration document and its option counter.
- No migration required.
- Rollback is a straight revert of token plumbing in `registration.html`, `js/registration-flow.js`, `functions/index.js`, rules, and unit assertions.
