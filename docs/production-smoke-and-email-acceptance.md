# Production smoke and email acceptance

The production smoke contract uses a synthetic team and dedicated accounts. Do not
reuse a real family or roster for this suite.

## Protected configuration

Store these values in the protected GitHub environment named `production-smoke`:

- Secrets: `SMOKE_STAFF_EMAIL`, `SMOKE_STAFF_PASSWORD`,
  `SMOKE_PARENT_EMAIL`, and `SMOKE_PARENT_PASSWORD`.
- Required variables: `SMOKE_TEAM_ID`, `SMOKE_PLAYER_ID`,
  `SMOKE_GAME_ID`, `SMOKE_EVENT_ID`, and `SMOKE_REGISTRATION_FORM_ID`.
- Extended-write gate: `SMOKE_EXTENDED_WRITES_ENABLED`. Leave it unset or set
  it to `0` for the default read-only nightly suite.
- Optional variables: `SMOKE_CONVERSATION_ID`,
  `SMOKE_OPPORTUNITY_LISTING_ID`, and `SMOKE_OPPORTUNITY_INQUIRY_ID`.

The staff account must be verified and have least-privilege owner/admin access to
the synthetic team. The parent account must be verified and linked to the smoke
player and team. The smoke event must have a seeded RSVP and tracker
configuration. The smoke team also needs one writable media album, a fee
recipient, a registration application for the configured form, a published
award, and a current official assignment. Each role needs at least one seeded
notification. If the optional opportunity inquiry is configured, seed at least
one reply and its notification deep link.

`SMOKE_AUTH_EMAIL` and `SMOKE_AUTH_PASSWORD` remain temporary compatibility
aliases. New workflows use the role-specific names.

For local operator runs, retrieve values from Keychain into the current process.
Do not put passwords in source files, shell history, command-line arguments,
artifacts, screenshots, traces, videos, or chat.

## Automated tiers

The post-deploy workflow checks out the exact released SHA and always runs:

- public app and marketing/legal/support boots;
- intentional public game/replay/report routes when fixture IDs are supplied;
- compatibility redirects for legacy login, signup, invite, reset, and
  verification URLs;
- a protected sign-in on the Firebase candidate origin and the canonical
  production origin.

When every required fixture ID and both distinct role-specific account pairs
are configured, the same workflow also runs:

- staff and parent sign-in, refresh persistence, protected routes, role
  boundaries, logout, and signed-out rejection;
- fixture-backed staff, parent, notification, registration, fees, media,
  certificate, schedule, message, official, profile, and help views.

Missing fixture-backed configuration is reported by name as a workflow warning
and `not-configured` summary row; it does not convert successful baseline
release probes into a false production outage. Once configured, any
fixture-backed failure remains fail-closed. The nightly workflow remains the
authoritative configuration and extended-coverage sentinel.

The nightly workflow always runs the core read-only checks. Extended mutations
are opt-in: set `SMOKE_EXTENDED_WRITES_ENABLED=1` only after the synthetic team
is isolated from real recipients and asynchronous notification inbox/batch
side-effects have an independent reconciliation path. Until then, keep the gate
disabled.

The extended suite uses the `allplays-smoke-<run-id>` prefix. It creates and
removes a roster player and event, sends/edits/deletes a chat message and
verifies its notification deep link, records and undoes a tracker entry,
restores RSVP, creates and removes a rideshare offer, uploads and deletes a
fixed one-pixel image, creates/revokes/removes a family-share token, and reads
the pre-seeded opportunity inquiry/reply fixture without mutating it. Direct
record cleanup runs in `finally`; a cleanup failure fails the suite and reports
only the record type and run ID. Scheduled runs are serialized without
cancellation so a newer run cannot interrupt that cleanup. Runner termination
or timeout can still bypass browser cleanup, which is why the gate must remain
disabled until independent reconciliation exists.

Playwright trace, video, and screenshots are disabled. Diagnostics redact email
addresses, action parameters, tokens, and document-like identifiers.

## Gmail-backed operator acceptance

Run this manually before routing releases and after authentication or email
changes. Use the connected `pauljsnider@gmail.com` mailbox. Gmail OAuth
credentials and one-time action URLs must never be placed in GitHub Actions.

1. Generate a UTC run ID and use the recipient alias
   `pauljsnider+allplays-smoke-<run-id>@gmail.com`.
2. Start with a clean browser context with tracing, video, screenshots, and URL
   logging disabled.
3. Search Gmail for each exact message using recipient alias, subject, and a
   narrow time window. Read only the matching message and raw MIME. Do not
   archive, label, trash, forward, or reply.
4. For raw MIME authentication results, require `dkim=pass`, `spf=pass`, and
   `dmarc=pass`, and confirm the message has the `INBOX` label. Do not copy raw
   headers or message bodies into test output.
5. Exercise each case below. Record only pass/fail, message type, run ID, and the
   final route with all query and hash values removed.

### Required cases

- Password reset: request delivery, open the exact one-time link, confirm the
  `/app` reset route and valid reset UI. Complete the password change only on
  the disposable account.
- Email verification: create an unverified disposable account, open its exact
  message, verify once, and confirm verified state plus the app continuation.
- Invite/passwordless sign-in: create a fresh invite, open it in the clean
  context, sign in or create the disposable account, redeem once, and verify the
  role destination. A second redemption must be rejected safely.
- Parent/household or admin invite: run one reversible representative invite.
  Unit tests cover every invite-type mapping.
- Team email and registration-payment reminder: verify the expected app-capable
  deep link or the documented public exception.
- Reply-To and exceptions: confirm Reply-To remains an email action and public
  live-game, replay/report, signed RSVP, widget, Stripe checkout, legal,
  marketing, and external links remain outside the app where intended.

Delete the disposable Firebase account and revoke/remove its smoke-owned invite
or access records after the run. Do not delete Gmail messages as part of
acceptance.
