# Requirements: Issue #4367

## Objective

Make `parentFeesService` fail closed on stored checkout destinations and regenerate checkout through the server when stored metadata is missing or untrusted.

## Root cause

`hasReusableParentTeamFeeCheckoutUrl` treats any non-empty URL with blank or `open` checkout status as reusable. It does not parse or validate the scheme, hostname, credentials, or port, so poisoned stored metadata can become `paymentAction: 'checkoutUrl'`.

## Required behavior

- Reuse only absolute HTTPS URLs on the exact `checkout.stripe.com` hostname, without credentials or a non-default port.
- Preserve trusted open destinations as `paymentAction: 'checkoutUrl'`.
- Route otherwise payable online fees with invalid or missing destinations to `paymentAction: 'createCheckout'`.
- Validate the server-generated destination with the same policy.
- Return a retry-oriented error for missing, invalid, or failed regeneration without falling back to stored metadata.

## Boundaries

FeesTool rendering, legacy parent dashboards, Firestore authorization, Stripe callable session-reuse validation, and staff sharing remain out of scope.
