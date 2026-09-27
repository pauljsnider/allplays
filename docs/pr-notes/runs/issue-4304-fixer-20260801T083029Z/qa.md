# QA Strategy

## Regression matrix

Apply to parent, household, and co-parent invites:

| Auth identity | Request email | Result | Writes |
|---|---|---|---|
| Matching token email | Any | Success | Existing atomic grant |
| No token email, matching Admin Auth email | Any | Success | Existing atomic grant |
| No authoritative email | Matching spoof | `permission-denied` | Zero |
| Mismatched token or Admin Auth email | Matching spoof | `permission-denied` | Zero |
| Matching mutable profile only | Matching spoof | `permission-denied` | Zero |

Token email must take precedence over a differing Admin Auth record. Untargeted invites remain redeemable. Denials must leave the access code pending and user grants, household membership, public projection, and private player profile unchanged.

## Test boundaries

- Direct helper unit tests cover authoritative identity resolution and failure branches.
- Source contracts cover all three callable blocks, pre-write guard ordering, and client payload omission.
- Existing legacy, React, and Capacitor routing tests remain the compatibility control.

## Focused validation

Run the new identity test plus the parent, household, and co-parent unit contracts, then `node scripts/check-critical-cache-bust.mjs`. No native build or broad smoke suite is required for this server/adapter authorization patch.
