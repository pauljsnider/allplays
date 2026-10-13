# Browser email sign-in pilot — release blocked

Draft implementation for the existing paul@allplays.ai account only. The
production release gate in `functions/web-sign-in-pilot.cjs` is deliberately
false and its UID binding is empty. There is no login-screen entry point yet;
the prepared request/completion screen is `/app/#/email-sign-in`.
Do not enable the gate merely because these local tests pass.

## Release blockers

1. Firebase email-link redemption is a sign-in-or-create operation. A generated
   OOB link can be redeemed directly, bypassing our preflight. Deleting or
   reassigning the account between issuance/preflight and redemption can create
   another account. A custom-token substitution also allows account recreation.
   The requested absolute no-new-accounts guarantee needs an approved Auth-level
   enforcement design, with direct-redemption and deletion-race tests. Changing
   live Auth/security configuration requires separate action-time approval.
2. Pin the existing UID only after that design is settled. An authorized
   read-only lookup on 2026-10-13 confirmed the account exists, emailVerified is
   true, and the password provider is present. The initial 403 was resolved by
   supplying the explicit project quota header. No credentials were changed.
3. Draft PR checks skip heavy jobs by repository policy. Do not mark ready or
   remove external-claim while blockers remain: that hands ownership to PaulBot.

Production deployment and bounded inbox validation are now authorized, but that
approval does not authorize new Auth/security configuration or credential
changes. No live sign-in email has been requested or consumed during this work.

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
Firebase redemption, another reason the gate must stay closed.

The browser screen requires explicit Continue; email is recalled from local
storage or re-entered on another device. URL email values are ignored. It offers
resend, password/Google recovery, and explicit sign-out for a different account.
It does not consume invitation state. Native completion is rejected. Password
and Google login screens are unchanged.

## Live procedure after blockers are resolved and the approved release succeeds

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
  interrupted-completion redirects. No remaining code findings; activation
  blocker above remains.
- Full Functions security suite: 1,615 passed, seven skipped, one failed.
  Unchanged migration-firestore-credential test expected its credential probe but
  got DNS UNAVAILABLE for firestore.googleapis.com in the restricted executor.
  No production migration was run. This is not a passing aggregate check.
