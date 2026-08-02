# Architecture: Issue #4367

## Minimal safe design

- Add one pure Stripe Checkout URL validator in `parentFeesService.ts`.
- Require both the existing open-status rule and a trusted destination before reuse.
- Use raw metadata only to preserve legacy online-collection classification, but expose only a trusted URL in `ParentFeeAppRecord`.
- Route invalid or missing destinations to server checkout creation when the fee remains eligible and identifiers exist.
- Validate callable output through the same helper and fail recoverably on rejection or invalid output.

## Canonical policy

Accept only parseable absolute URLs with `https:`, exact hostname `checkout.stripe.com`, empty username/password, and no explicit non-default port. Reject malformed, relative, HTTP, lookalike, credential-bearing, and alternate-host destinations.

## Safety and blast radius

The change is limited to the app parent-fees service and focused tests. Authorization remains server-enforced. No URLs are logged, no schema changes are introduced, and failed regeneration leaves the user able to retry without navigation.
