# Browser email sign-in

The unlisted browser entry is `/app/#/email-sign-in`. The October 14 rollout
extends the original Paul-only pilot to existing verified, enabled accounts whose
only Firebase provider is `password`, with no enrolled MFA. Firebase uses that
provider ID for both password and email-link authentication; it does not prove a
password is set. Unknown, unverified, disabled, Google-linked (including accounts
with both password and Google), MFA and other-provider accounts are excluded.
Password and Google login remain available through their existing flows.

## Release authorization and accepted boundary

On October 14 Paul directed completion of the broad rollout after the recap
explicitly disclosed the outstanding-link deletion/email-reassignment risk and
the shared five-request daily ceiling. This acceptance applies to the expanded
eligible account population, not only Paul's account.

Firebase email links can be redeemed directly, bypassing application preflight.
Deleting an account or changing/reassigning its email while a link is valid can
create or reach a replacement account. Existing verified-email permission grants
mean that replacement cannot be assumed to lack prior access. The application
rejects detected UID/email/provider drift and never rebinds an outstanding link.
The 15-minute application completion deadline does not shorten Firebase's direct
redemption lifetime. Do not mutate live accounts to test this boundary; use the
local Auth emulator. No Identity Platform upgrade or Auth/security setting change
is part of this rollout.

Normal exact-head review/CI, PaulBot landing, deployment and canonical production
smoke remain mandatory. PR #5048's sequencing hold was cleared after its verified
release. Once handed off, PaulBot is the sole writer; producers do not push or
merge in parallel. Coordinate any live email test with the account owner and
parent task; release approval does not authorize credential/provider changes.

## Behavior and limits

All requests receive the same generic response, including ineligible accounts,
rate limits and errors. Before lookup, one transaction reserves the existing
shared global budget and a hashed per-recipient budget: one request per minute
and five per UTC day for each. Successfully reserved attempts consume budget
even if lookup or delivery fails,
including ineligible accounts and ambiguous delivery outcomes. Malformed input
and requests rejected by cooldown/caps do not consume additional reservations.
The five/day global ceiling is shared by every recipient, so an
otherwise eligible account may receive no email after the budget is exhausted.
Do not raise limits to accelerate testing.

The server looks up the existing account by normalized email, checks eligibility,
and captures its UID and email in a private record keyed by the code's hash.
Preflight reads that exact UID and rejects changed email, providers, verification,
disabled/MFA state, a different signed-in UID or expiration. It does not resolve
an outstanding link to a replacement UID. Old pilot records lacking the captured
email fail closed; request a new link. Only `/home`, `/teams`, `/schedule` and
`/profile` are accepted return routes. Teams, roles and profile data are not
written by the sign-in flow, and any existing password remains unchanged.

Resend uses the existing durable delivery record and stable idempotency key.
Sign-in copy has no invitation text or password-reset fallback. Completion
requires explicit Continue. Same-browser email recall is local storage only;
another browser requires re-entry. URL email parameters are not identity proof.
Wrong-account recovery uses central sign-out and cache cleanup. The flow clears
pending push navigation without consuming invitation state. Native completion
is rejected and no login/navigation entry is added.

## Validation after the approved release

1. Verify the deployed SHA, completed Firebase/Hosting/Pages release marker and
   successful exact-release canonical smoke. Record production verification
   separately from local/CI preparation.
2. With the account owner's approval, choose an existing eligible account; a
   non-Paul account demonstrates the expanded scope. Record a minimal private
   baseline of UID, provider IDs, verification/enabled/MFA state and existing
   teams/roles. Do not log credentials or raw account records. Do not assume a
   password exists solely from the provider ID.
3. In a signed-out browser, open the unlisted URL and request one link for that
   account. Expect sender `ALL PLAYS <noreply@mail.allplays.ai>` and subject
   `Sign in to ALL PLAYS`. Generic confirmation is not proof of email delivery;
   check the correct inbox and the newest request, considering the shared cap.
4. Open only the fresh email, confirm the recalled email and explicitly Continue.
   Do not copy the bearer URL/code into logs, reports, screenshots or PR comments.
   Confirm the expected account, safe destination and unchanged teams/roles.
   Do not write team/game data.
5. Compare the resulting UID and provider state with the baseline. If the account
   already has a password, let its owner privately verify that password still
   signs in after sign-out. Do not create/reset a password for a link-only account
   or add/remove providers to test eligibility.
6. If budget permits, wait at least a minute, request a fresh link, and open it in
   another browser. Re-enter the same email, correct a wrong email if necessary,
   and explicitly sign out of a different account. Sign out before reopening a consumed link to verify used-link recovery and
   Request a new link; a matching already-signed-in UID intentionally continues
   without redeeming the code again. Use local fixtures for expiry, interrupted/repeated flows,
   unsafe redirects, stale invitation/push state and excluded account variants.
7. Confirm excluded accounts retain their ordinary login methods. Do not enumerate
   live recipients or consume the small global budget testing the exclusion
   matrix. Never delete, reassign, unverify or change providers on live accounts
   as a test. Record any unresolved result rather than changing security settings.

## Local and CI checks

- `npm run test:functions:auth-email`: eligibility, captured UID/email, recovery,
  safe redirects, invitation-copy isolation, durable per-recipient/global limits
  and concurrent requests. Fixtures do not send live mail.
- App `webSignInPilot`, `EmailSignIn`, `AuthPage` and `AcceptInvite` suites; app
  build/typecheck/lint and coverage map.
- Local mocked `app-web-sign-in-pilot.spec.js` blocks non-local network traffic.
- Demo Auth emulator verifies existing UID/password continuity, used/disabled
  rejection and the known direct-redemption lifecycle boundary. Never point
  these lifecycle probes at production.
- Exact-head PR fast/integration gates and post-release canonical smoke remain
  authoritative. Prior-head green runs do not validate a changed head.

Preparation evidence for `7d94fe7dc` (before runbook correction): 77 auth-email
checks, 72 focused app checks, local browser/build/typecheck/lint and emulator
probes passed. Manual CI 38500652599 passed (3,574 app tests; 1,622 Functions
security tests, seven skipped); staged smoke 38500656675 passed (562 tests,
25 skipped, plus five visual checks). These are preparation results, not proof
of rollout deployment. Revalidate the final remediation head before release.
