# QA Role

## Risk Matrix

- High: role-gating drift from backend authorization.
- High: navigation to an untrusted provider destination.
- Medium: stale entitlement after checkout return.
- Medium: duplicate checkout invocation from rapid taps.
- Medium: wrong-season checkout scope.
- Low: unrelated Team Detail or website-link regression.

## Automated Tests To Add/Update

- `TeamDetail.test.tsx`: eligible staff and confirmed-parent visibility; fan, wrong-team parent, active pass, global/default-open, loading/unavailable, and missing-season suppression; exact payload; pending deduplication; retry; no navigation on failure; armed return refresh.
- `teamDetailService.test.ts`: web/native callable routing and fresh-response validation.
- `usePremiumFeatureAccess.test.tsx`: refresh-version change repeats the same scoped lookup.
- Existing `stripeCheckoutUrl.test.ts` remains the validator contract check.

## Manual Test Plan

- Verify owner/admin/confirmed-parent purchase and fan suppression on the same premium-enforced team.
- Verify pending, offline failure, retry, Stripe open, and return refresh.
- Verify active and global-open states suppress checkout.

## Negative Tests

- Do not infer eligibility from a role label, linked player, public team, platform admin, legacy owner email, or wrong-team parent relationship.
- Do not navigate on rejected checkout or invalid/missing URL.
- Do not show purchase while premium data is loading/unavailable.
- Do not issue duplicate pending requests or use a fallback season.
- Do not refresh entitlement on ordinary resume until checkout is armed.

## Release Gates

- `npm run test:app -- src/pages/TeamDetail.test.tsx`
- `npm run test:app -- src/lib/teamDetailService.test.ts`
- `npm run test:app -- src/lib/usePremiumFeatureAccess.test.tsx`
- `npm run test:app -- src/lib/stripeCheckoutUrl.test.ts`
- `npm run app:build`

## Post-Deploy Checks

- Verify deployed staff, confirmed-parent, and fan behavior.
- Confirm exact current-season callable payload and one request per tap.
- Confirm only canonical Stripe opens and return refresh suppresses the CTA after entitlement activation.
- Check client and Functions logs for permission, destination, and duplicate-attempt failures.
