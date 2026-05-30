# Code Plan, Issue #1534

## Files
- `registration.html`
  - Await checkout initiation inside a nested try/catch after `preparedCheckoutRegistration` is set.
  - On thrown checkout initiation or no URL, call `releaseCancelledStripeRegistration(result.registrationId)` and clear `preparedCheckoutRegistration`.
- `functions/index.js`
  - Relax release guard for unpaid pre-checkout `pending`/`waitlisted` reservations with no checkout/payment status.
  - Keep paid and already-released guards intact.
- `tests/unit/registration-flow.test.js`
  - Update retry/capacity expectations from retained count to released count.
  - Add missing checkout URL regression coverage.
  - Add source guards for the relaxed release condition.

## Conflict Resolution
All roles aligned on a minimal reserve-first patch. Chosen direction reuses the existing cancellation/release callable instead of adding a new API/status surface.
