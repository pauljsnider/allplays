# QA: Issue #4367

## Regression boundary

Add `apps/app/src/lib/parentFeesService.test.ts` with deterministic mocks for the legacy adapter. Keep validation at the service boundary because FeesTool rendering and navigation are out of scope.

## Matrix

- Trusted stored HTTPS Stripe URL is retained and reused.
- HTTP, malformed, credential-bearing, lookalike/non-Stripe, and explicit-port stored URLs are scrubbed and select regeneration.
- Missing stored URL selects regeneration for an otherwise payable online fee.
- Trusted regenerated URL is returned.
- Empty, invalid, or rejected regeneration produces an error and no rejected destination.
- Existing eligibility and identifier gates remain closed.

## Focused command

`npm run test:app -- src/lib/parentFeesService.test.ts`
