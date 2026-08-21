# Architecture Role

## Current-State Read

- `TeamPassCard` is status-only and links to the legacy website.
- `teamDetailService.ts` has Firebase callable dependencies but no Team Pass checkout wrapper.
- `usePremiumFeatureAccess` has no explicit refresh input.
- The backend checkout already owns authentication, eligibility, entitlement, reservation, Stripe validation, and persistence.
- Root cause: the React migration retained Team Pass presentation but omitted checkout and return-refresh integration.

## Proposed Design

- Project a dedicated `canPurchaseTeamPass` value in `buildTeamDetailModel` using backend-equivalent owner, current-email admin, and exact parent-team rules.
- Add `createTeamPassCheckoutForApp(teamId, seasonId)` using web `httpsCallable` or native `callNativeFirebaseFunction`.
- Validate the fresh response with `requireTrustedStripeCheckoutUrl` and return only the trusted URL.
- Render the CTA only for an eligible model, locked premium state, and nonempty current season.
- Use local pending/error state plus a synchronous ref mutex.
- Add a premium refresh version and consume an armed checkout-return signal through the existing resume lifecycle.

## Files And Modules Touched

- `apps/app/src/lib/teamDetailService.ts`
- `apps/app/src/lib/teamDetailService.test.ts`
- `apps/app/src/lib/usePremiumFeatureAccess.ts`
- `apps/app/src/lib/usePremiumFeatureAccess.test.tsx`
- `apps/app/src/pages/TeamDetail.tsx`
- `apps/app/src/pages/TeamDetail.test.tsx`

## Data/State Impacts

- No persisted schema changes.
- Checkout is scoped to exact team, current season, and fixed tier.
- Checkout URLs are not read from or written to team-readable state.
- New state is transient: pending, error, refresh arm, and refresh version.

## Security/Permissions Impacts

- UI gating mirrors the backend but remains advisory; the callable is authoritative.
- Current Auth email is used for admin projection, never a mutable profile email.
- Canonical `ownerId` precedence is preserved.
- Shared canonical Stripe validation runs at the fresh-response boundary.
- Native transport preserves Auth and App Check behavior.

## Failure Modes And Mitigations

- Rejection/network/App Check/Auth failures clear pending and allow retry.
- Invalid URLs fail before navigation.
- A ref mutex blocks pre-render duplicate taps.
- Missing season and unavailable entitlement fail closed.
- Checkout return refreshes entitlement only, avoiding a full Team Detail reload.
- Platform-admin-only and legacy-owner-email users remain suppressed because the server would reject them.
