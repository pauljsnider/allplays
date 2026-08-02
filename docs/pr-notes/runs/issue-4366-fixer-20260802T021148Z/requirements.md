# Requirements analysis

## Objective

Ensure the legacy parent fee dashboard exposes only canonical Stripe Checkout destinations and fails closed with a recoverable state for missing or invalid URLs.

## Acceptance interpretation

- Trust only absolute HTTPS URLs on the exact `checkout.stripe.com` hostname, without credentials or an explicit port, and with a non-root path.
- Reject HTTP, malformed, protocol-relative, credential-bearing, non-Stripe, lookalike-host, nonstandard-port, empty, and root-only destinations.
- Never include a rejected raw destination in rendered HTML.
- Preserve the existing checkout-initiation button as the retry path when team, batch, and recipient context is available.
- Without retry context, show visible non-navigable recovery text.
- Preserve payments-disabled, offline, paid, canceled, adjusted, and zero-balance behavior.

## Root-cause hypothesis

The first truthy legacy checkout URL alias is normalized without destination validation and later interpolated into `href`. An invalid truthy URL also blocks the existing initiation button.

## Scope

Limit the change to the legacy parent fee renderer and its focused unit tests. React, Capacitor, Firestore authorization, callable session reuse, and staff sharing remain out of scope.
