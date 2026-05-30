# Architecture

- Treat `checkoutAttemptToken` as the ownership token for pre-checkout reservations.
- Add a strict match helper requiring both stored and caller tokens for the pre-checkout release path.
- Keep the existing relaxed match helper for legacy/open checkout records where a prior branch already allowed missing tokens.
