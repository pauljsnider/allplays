# Requirements

Base SHA: `1604c95f66ced0086c8509976ddf0a4a69203e0c`

## Objective

Make team-fee checkout state server-authoritative and ensure `createStripeTeamFeeCheckout` never returns an unvalidated persisted or newly created destination.

## Acceptance mapping

- Owners, admins, parents, and unrelated users cannot create, change, clear, or delete checkout destinations, lifecycle fields, or Stripe session identifiers through client Firestore writes.
- Owners and admins retain normal recipient creation without protected fields and retain audited balance and non-checkout status updates.
- Reuse requires canonical `https://checkout.stripe.com` URLs without credentials, a live open unpaid Stripe payment session, matching session identity, current amount, attempt token, and team/batch/recipient metadata.
- HTTP, malformed, credential-bearing, lookalike, and non-Stripe destinations are never returned.
- Definitively stale legacy sessions may be replaced. Active mismatched sessions and ambiguous Stripe failures fail closed.
- Newly created Stripe sessions are validated before persistence or response.

## Actor matrix

| Actor | Safe create | Create/update checkout fields | Audited balance/status update | Invoke eligible checkout |
|---|---:|---:|---:|---:|
| Owner | allow | deny | allow | allow |
| Team admin | allow | deny | allow | allow |
| Linked parent | deny | deny | deny | allow for assigned recipient |
| Unrelated user | deny | deny | deny | deny |

## Root-cause hypothesis

The rules classified only selected private Stripe identifiers as protected while leaving checkout destinations and lifecycle metadata owner/admin writable. The callable then trusted those persisted fields and returned `recipient.checkoutUrl` without retrieving Stripe or validating URL origin, credentials, live state, amount, or metadata binding.

## Scope guardrails

No UI, pricing, installment, refund, webhook-fulfillment, or migration changes. Preserve current fee audit semantics and avoid logging checkout URLs, tokens, or full Stripe objects.
