# Code Plan

- Add `registrationCheckoutAttemptStrictlyMatches` in `functions/index.js`.
- Require the strict helper for `canReleasePreCheckoutReservation` before allowing capacity release.
- Update unit tests to inspect the release function and fail if the pre-checkout branch uses the relaxed matcher.
