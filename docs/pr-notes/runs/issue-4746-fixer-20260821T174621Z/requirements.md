# Requirements Role

## Problem Statement

React Team Detail reports Team Pass status but cannot start the existing authenticated checkout. Eligible owners, team admins, and confirmed parents need a current-season purchase action that fails closed on authorization, entitlement, or destination uncertainty and refreshes entitlement after returning from Stripe.

## User Segments Impacted

- Canonical team owners and current-email team admins.
- Confirmed parents whose authoritative `parentTeamIds` contains the team.
- Fans, generic coaches, linked-player-only users, and other ineligible viewers who must not see the action.
- Already-covered teams and globally unlocked users who do not need checkout.

## Acceptance Criteria

1. Eligible owners, team admins, and confirmed parents see **Buy Team Pass** only when premium access is locked for the loaded team's nonempty `currentSeasonId`.
2. Generic roles, public access, linked-player visibility, platform-admin-only access, legacy owner email, and wrong-team parent access do not expose the action.
3. Loading, unavailable, global/default-open, and active-entitlement states suppress the action.
4. Checkout uses the exact loaded team ID, current season ID, and fixed `team-pass` tier.
5. Only canonical HTTPS `checkout.stripe.com` destinations without credentials, ports, whitespace, or a root-only path may open.
6. Pending state disables the action and prevents duplicate calls.
7. Checkout creation or launch failures show a retryable inline error and do not navigate.
8. A checkout-armed foreground return re-reads entitlement for the same team and season; an active result removes the CTA.

## Non-Goals

- Legacy Team Pass panel changes.
- Backend authorization, reservation, Stripe session, webhook, or entitlement schema changes.
- Historical-season purchase, Playwright, or native-shell smoke coverage.

## Edge Cases

- Missing season fails closed instead of using a calendar-year fallback.
- Unavailable entitlement data is not treated as an absent pass.
- Multiple rapid taps create one client request.
- Invalid or deceptive checkout URLs never reach navigation.
- Cancelled or delayed checkout remains locked after refresh without claiming success.
- Checkout completion after navigating to another team must not update the prior team state.

## Open Questions

- Platform admins and legacy email-only owners are excluded because backend `isEligibleTeamPassPurchaser` excludes them.
- Confirmed parent means authoritative `parentTeamIds`, not a role label or linked-player inference.
- Immediate refresh is scoped to a checkout launched from this page.
