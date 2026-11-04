# SDK identity adapters and remaining composition boundary

This checkpoint adds unmounted backend identity adapters and tightens the final
REST dispatch guard. It creates no credentials, grants, routes, live data or
deployment. Existing production entry points remain unchanged.

## Fresh actor expiry

The final synchronous fetch guard now captures the minimum of the approved
form deadline and the actor expiry returned by the last authentication lookup.
A synthetic adapter that shortens actor expiry reproduced the earlier guard's
gap; its new regression passes. The current authenticator uses the same grant
expiry throughout, so this is defensive hardening rather than a demonstrated
production defect. The session/identity recheck after dispatch acknowledgment
and retention of dispatched fences remain unchanged.

## Concrete identity adapters

`functions/schedule-broker-identity.cjs` supplies two backend-only factories:

- `createFirebaseScheduleUserVerifier({ auth, projectId })` calls the configured
  Firebase Admin Auth instance's `verifyIdToken(token, true)` and then `getUser`.
  It checks the exact project/issuer/subject, enabled and verified current
  account, matching token/current email, current revocation timestamp and token
  timing after awaited reads. A caller cannot disable revocation checking.
  Missing revocation metadata follows the SDK's no-recorded-revocation case;
  malformed metadata is rejected. Returned identity omits token and email.
- `createGoogleScheduleWorkloadVerifier({ oauthClient, audience })` calls the
  actual Google OAuth2Client ID-token verifier with a fixed HTTPS audience.
  It additionally checks Google issuer, exact audience, numeric subject,
  verified service-account email and current timing after verification. The
  existing HTTP handler must still check its explicit principal allowlist;
  a valid Google signature alone does not authorize ingress.

Both adapters redact SDK errors and fail closed on malformed or unavailable
identity state. They accept host-supplied SDK instances; they do not initialize
an app, discover credentials, provision accounts or change IAM. Firebase Auth
access belongs in the reviewed backend, not the MCP application-data adapter.
Application data writes remain user-credentialed REST operations under rules.

Tests use the installed Google Auth Library 9.15.1 with ephemeral RSA keys and a
local certificate source, exercising its real signature verification without
Google network access. Firebase Auth is a mocked SDK interface in these tests;
live project, revocation and IAM configuration are not validated. Additional
tests compose both adapters with the actual private HTTP handler and signed
command channel. The executor and broker-session introspection remain synthetic
in that composition; those tests do not prove production command execution.

## Recommended next integration sequence

1. Implement authenticated, bounded broker-session introspection that returns
   only the exact UID/client/grant/session binding, current scope, connection
   state and expiry. Require independent workload authentication and a fixed
   audience. The backend must not receive or persist refresh credentials.
   Failure to read current session state must deny execution.
2. Compose the signed channel with the existing schedule command engine and
   credentialed store. Read the exact existing proposal, recompute preview and
   revisions, compare to the signed approved preview, and use the one-use
   approval/evidence authority. Do not build a second generic write engine or
   accept remote write plans, completion flags or client receipts as authority.
   Bridge the current UUID-v4 proposal requirement explicitly: the channel's
   broader bounded-ID parser is not sufficient for the domain engine.
3. Keep the signed-channel reservation and domain proposal receipt distinct.
   The former prevents transport replay; only the backend's actual verified
   commit observation can publish notification proof. An unknown channel or
   business-write result must be inspected, never automatically re-executed.
   Status across a replacement session still needs its own reviewed contract.
4. Connect the reviewed platform trigger to durable payload capture and the
   bounded recovery scanner. Migrate every real legacy consumer to the shared
   ownership gate before enabling journal delivery. Test actual legacy audience
   and serializer compatibility, not just the synthetic fallback planner.
5. Resolve background notification grant/revocation policy, recovery scheduling,
   dead-letter retention and ambiguous-dispatch resolution. Add isolated native
   client and live-provider validation only when those specific steps are
   authorized. None of these adapters implies production activation approval.

Current validation: **268 backend tests** across 16 suites, including the 33 new
identity tests; **398 MCP unit/protocol tests**; **65 Firestore emulator tests**
across broker/evidence, private journal and schedule/RSVP suites. Active legacy
notification code, server mounts, rules and dependency manifests are unchanged.
