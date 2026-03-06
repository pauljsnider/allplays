# Requirements Role Notes

## Objective
Prevent parent invite onboarding from being stranded when non-linking post-redeem profile writes fail.

## Decision
Treat `redeemParentInvite` as the only fail-closed step. Treat `updateUserProfile` as best-effort for parent-invite signups.

## User impact framing
- Parent, coach, and team manager outcomes: a successful invite redemption must continue the onboarding path even if profile writes hit transient Firestore errors.
- Hard-fail remains required when invite linkage itself fails, because the account is not correctly bound to the child/team context.

## Acceptance criteria
- Email/password parent invite flow: throws and cleans up only when `redeemParentInvite` fails.
- Google parent invite flow: throws and cleans up only when `redeemParentInvite` fails.
- In both flows, `updateUserProfile` failures after successful redemption are logged and do not throw.
- Existing standard activation-code signup behavior remains unchanged.

## Assumptions
- Parent invite redemption is authoritative for relationship creation and invite consumption.
- Missing profile fields are recoverable later and lower risk than hard onboarding blockage.
