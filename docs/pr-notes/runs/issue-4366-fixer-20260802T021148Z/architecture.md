# Architecture analysis

## Defect mechanism

HTML escaping prevents attribute injection but does not establish URL trust. Stored aliases flow directly into a navigable anchor, while invalid truthy values suppress safe retry.

## Trust invariant

A checkout destination must be an unmodified string that parses with protocol `https:`, exact hostname `checkout.stripe.com`, no username, password, or port, and a non-root pathname. This mirrors `functions/team-fees-core.cjs#getCanonicalStripeCheckoutUrl`.

## Minimal change

- Add a local pure canonicalizer in `js/parent-dashboard-fees.js` rather than importing server CommonJS code.
- Normalize rejected aliases to an empty destination before rendering.
- Render a trusted anchor, otherwise the existing callable-backed button when identifiers are complete, otherwise generic recovery text.
- Never echo rejected destinations.

## Blast radius and safety

The change affects only legacy parent fee cards and their URL aliases. It performs no writes and changes no callable behavior. Callable-returned URL validation is an adjacent boundary but outside this stored-link slice.

Authorization and confirmation behavior are unchanged. Privacy improves because rejected credential-bearing values are not echoed. Retention, deletion, atomicity, idempotency, reload durability, collection limits, and interrupted-browser recovery are not applicable because this patch performs no persistence or mutation. Partial failure remains recoverable through the existing callable-backed retry button or visible refresh guidance.
