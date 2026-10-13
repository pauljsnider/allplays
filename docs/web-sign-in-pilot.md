# Browser email sign-in pilot

Paul approved this browser-only pilot on 2026-10-13 after accepting the disclosed
outstanding-link deletion/email-reassignment boundary. The server gate is enabled
in code and binds only the independently verified original UID. No caller input
can change or rebind it. The pilot entry is `/app/#/email-sign-in`; password and
Google login remain unchanged.

## Release conditions and accepted boundary

Firebase email links can be redeemed directly, bypassing application preflight.
If the account is deleted or its email changes while a link remains valid,
redemption may create or reach a replacement account. Existing rules include
verified-email grants, so that account cannot be assumed to lack prior access.
Paul accepted the bounded pilot while retaining the original account and email.
Reject detected UID/email/provider drift; never automatically rebind or repair
the live account. No Identity Platform upgrade or Auth setting change is needed.

A fresh narrow read confirmed the original UID/email, verified email, password
provider, enabled user, and no enrolled MFA. Project email-link login is already
enabled. No live credentials or provider settings were changed.

Merge/deployment and bounded inbox validation are approved only after final
review/CI and release sequencing clearance from the PR #5048 owner. Keep the
draft/external-claim until the final head is frozen and sequencing is clear.
Coordinate with the parent before requesting a live link.

## Prepared behavior

The request callable returns the same generic result for all recipients and
failures. Only the normalized pilot email can reserve a send. A transaction
limits the entire pilot to one send per minute and five per UTC day, including
failed/ambiguous sends. Existing UID, enabled state, verified email, password
provider, and absence of unsupported MFA are checked before generation and at
preflight. A private hash-keyed record binds the code to that UID and one of
four exact return routes; profile/team/role data is never written by the pilot.

Resend uses the existing durable delivery record and stable idempotency key.
The new email type has no invitation text or Firebase password-reset fallback.
The 15-minute app preflight expiry is not an Auth-enforced expiry for direct
Firebase redemption; the email accurately describes the app completion deadline.

The browser screen requires explicit Continue; email is recalled from local
storage or re-entered on another device. URL email values are ignored. It offers
resend, password/Google recovery, and explicit sign-out for a different account.
It does not consume invitation state. Native completion is rejected. Password
and Google login screens are unchanged.

## Live procedure after the approved release succeeds

1. Verify the exact deployed release SHA and required smoke checks. Read the
   account's UID/providers/emailVerified/disabled/MFA state again. Compare UID,
   team memberships, roles, and password-provider presence to the baseline.
2. Verify alias delivery to the connected Gmail inbox. Historical forwarding was
   confirmed by the parent; current delivery remains untested.
3. In a signed-out browser open `/app/#/email-sign-in`, enter paul@allplays.ai and
   request one link. Record request time, expected sender
   `ALL PLAYS <noreply@mail.allplays.ai>`, and subject `Sign in to ALL PLAYS`.
4. Match only the newly requested email. Never paste its link/code into reports,
   logs, screenshots, or PR comments. Open it in that browser; confirm recalled
   email and that no sign-in happens until Continue. Continue and check the
   expected account and destination. No team/game writes.
5. Read the existing UID/providers/verified state again and compare memberships
   and roles without changing them. Sign out and verify the original password
   still works, with Paul entering the password privately. Leave Google intact.
6. After the cooldown, request another link and open it in another browser.
   Re-enter the same email; do not derive identity from URL parameters. Test
   wrong-email correction and explicitly sign out of any different account.
7. Check used-link and expired-link recovery, refresh/interruption, double-click,
   resend, unsafe next values, and stale invitation/push state. Confirm no
   invitation is redeemed. Stay within the five-per-day pilot budget; do not
   raise limits to speed testing. Use local fixtures for remaining edge cases.

## Local validation

Backend: `node --test functions/test/auth-email-*.test.cjs`.
App: the `webSignInPilot`, `EmailSignIn`, `AuthPage`, and `AcceptInvite` suites;
app typecheck, changed-file ESLint/Prettier, and root `app:build` aggregate.
Backend tests enable only an injected in-memory fixture, never production.

## Validation evidence (2026-10-13)

- Auth-email Functions suite: 71 passed, including nine pilot tests.
- Focused app suites (pilot services/screen, AuthPage, AcceptInvite): 71 passed.
  Final pilot-only rerun: 15 passed.
- Firestore emulator privacy checks: four passed against demo-allplays, now
  included in the existing calendar-token rules suite run by aggregate CI.
- Changed app files: ESLint, Prettier, strict typecheck passed.
- `npm run app:build`: passed, including bundle visualizer and cold-start budget
  (51.5 KB entry; 399.4 KB gzip initial assets).
- Local Chromium browser smoke: one passed; all non-local traffic blocked.
- Independent code/security review: fixed stale push-to-invitation navigation and
  interrupted-completion redirects. Renewed independent review of the enabled pilot found no must-fix findings;
  corrected one stale gate comment.
- Full Functions security suite: 1,615 passed, seven skipped, one failed.
  Unchanged migration-firestore-credential test expected its credential probe but
  got DNS UNAVAILABLE for firestore.googleapis.com in the restricted executor.
  No production migration was run. This is not a passing aggregate check.
