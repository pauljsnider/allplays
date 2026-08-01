# Requirements: Issue #4304

## Objective

Bind email-targeted family invite redemption to the authenticated Firebase identity so request payloads cannot mint durable parent access.

## Invariant and acceptance

- The normalized invite email must match either `context.auth.token.email` or, when absent, `admin.auth().getUser(context.auth.uid).email`.
- Request `authEmail` and mutable profile email are never authorization inputs.
- Missing or mismatched authoritative email returns `permission-denied` before any access-code, membership, public-profile, or private-profile write.
- Email-less invites retain their existing bearer-code behavior.
- Matching identities keep the existing success payload and atomic writes across legacy, React, and Capacitor flows.

## UX and scope

Denied users receive the existing safe sign-in-with-the-invited-email guidance and the invite remains pending. No new prompts or platform-specific behavior are added. Invite generation, delivery, expiration, admin invites, family-share tokens, and email-verification policy are non-goals.

## Assumptions and risks

- A Firebase Auth user-record email is authoritative even when absent from the current token.
- Existing client function signatures remain compatible, but email arguments are not sent to the callable.
- Duplicated handlers create recurrence risk, so one resolver and three-handler source contracts are required.

## Root cause and prevention

Three privileged callables treated `data.authEmail` as equivalent to a Firebase Auth claim when the token lacked an email. Future privileged identity decisions must use signed context or server-side Auth lookup only; request and profile fields are display or UX data, never identity evidence.
