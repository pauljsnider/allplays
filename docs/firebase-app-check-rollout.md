# Firebase App Check rollout

## AI Logic requires valid attestation

Firebase documents automatic App Check enforcement for AI Logic beginning
November 2, 2026. The historical monitoring-only guidance below must not be
used as evidence that AI generation can work without a valid token. See the
[Firebase AI Logic App Check guidance](https://firebase.google.com/docs/ai-logic/app-check).

All generation consumers use `js/firebase-ai.js`. It waits for a real token
before creating the Firebase AI service, then permits one forced-token refresh
and generation retry only after an explicit App Check 401/403. It does not
retry writes, arbitrary permission errors, rate limits, or ambiguous network
failures. Missing/unavailable attestation produces an actionable error; manual
entry and well-formed deterministic CSV imports remain available.

The native app shell remains non-blocking. AI alone can await the bounded
native token loader and activate a late startup token without waiting for the
background retry. A known-expired native token is never assigned a new fallback
lifetime. This changes no provider selection, debug-token policy, server
enforcement, or project access settings.

Before declaring an AI incident resolved:

1. Inspect deployed public runtime configuration and the installed app version
   separately. Hosted web configuration does not prove the configuration inside
   a packaged Android/iOS release.
2. Obtain an authorized read of AI Logic enforcement and the exact production
   app/provider registrations. Verify the web hostname allowlist and Android
   Play signing fingerprints/iOS App Attest configuration. Never publish tokens.
3. For web, an approved rollout must publish the existing registered public
   reCAPTCHA Enterprise key with `APP_CHECK_ENFORCEMENT_READY=true` through the
   normal release process. This enables attestation assessments and requires
   operator approval; do not infer that approval from a code fix. A deployed
   `enabled:false` configuration cannot provide the token required by AI.
4. Release native code through the existing mobile process. Hosting changes
   alone do not update packaged native clients.
5. On supported web, Play-distributed Android and iOS installs, use synthetic
   image/PDF/text roster and schedule previews. Check cold start, resume after
   expiry, offline recovery, and rejected renewal. Do not confirm customer rows
   or invitations during diagnosis. Confirm useful errors and deterministic
   CSV/manual fallback when attestation cannot recover.

Do not disable or delay enforcement, strip a rejected token, register production
debug tokens, or relax API-key/provider restrictions to make a smoke test pass.

## Monitoring and existing protection

General Firebase initialization retains its historical non-blocking behavior.
The AI request boundary separately requires successful token acquisition.
Neither client behavior changes Firebase Console enforcement.

Candidate-host validation and DNS cutover observation follow the
[hosting cutover runbook](hosting-cutover-runbook.md). Preserve the currently
active protection policy during cutover. Historical instructions describing
unenforced monitoring do not authorize weakening an already enforced service.

## Client configuration

### Web

1. In Google Cloud Console, create a reCAPTCHA Enterprise website key for the
   production web app. Allow the actual hosted domains (`allplays.ai`,
   `www.allplays.ai`, `game-flow-c6311.web.app`,
   `game-flow-c6311.firebaseapp.com`, and the GitHub Pages hostname if that copy
   remains operational). Do not allow `localhost`.
2. In Firebase Console > App Check > Apps, register web app
   `1:982493478258:web:1f942c420cef6c40e8b1eb` with that key.
3. Set the public GitHub Actions repository variable
   `APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY`. The staging workflow writes only
   this public key to `/.well-known/allplays-runtime-config.json`; no debug token
   or credential is written to the bundle.
   The historical unset/`false` gate publishes disabled web attestation. For
   AI-capable production releases, an approved rollout must set
   `APP_CHECK_ENFORCEMENT_READY=true`; production and Pages staging then fail
   instead of publishing a missing or malformed site key. Validate the provider
   and allowed domains before that configuration change.
4. Preview channels use dynamic sibling hosts such as
   `game-flow-c6311--<channel>-<hash>.web.app`. The production hostname allowlist
   does not cover these hosts, and allowing all of `web.app` is unsafe. The
   preview workflow therefore accepts only the separate public repository
   variable `APP_CHECK_PREVIEW_RECAPTCHA_ENTERPRISE_SITE_KEY`; set it only when
   a controlled preview hostname/provider strategy has been registered. With
   `APP_CHECK_ENFORCEMENT_READY=true`, preview staging intentionally fails if
   that variable is missing. Until that strategy exists, preview builds cannot
   demonstrate production attestation. Use isolated synthetic fixtures for local
   regression tests; do not weaken production enforcement for a preview.
5. For direct builds, the equivalent runtime contract is:

   ```js
   window.__ALLPLAYS_CONFIG__ = {
       appCheck: {
           enabled: true,
           recaptchaEnterpriseSiteKey: 'PUBLIC_ENTERPRISE_SITE_KEY',
           isTokenAutoRefreshEnabled: true
       }
   };
   ```

Local web origins automatically select the Firebase debug provider. Use an
isolated development project and its approved debug-token registration process.
Never register a production debug token for incident diagnosis, or commit/share
a registered debug token.

### iOS and Android

The Capacitor app initializes native attestation and bridges its token into the
Firebase JavaScript SDK so Firestore, Functions, Storage, and Firebase AI Logic
all use the native token.

- iOS app `1:982493478258:ios:7b16b3f187c59aece8b1eb`
  (`ai.allplays.lite`): register App Attest. The checked-in entitlement uses the
  production App Attest environment. Upload a DeviceCheck-capable key only if a
  DeviceCheck fallback is introduced later.
- Android app `1:982493478258:android:ceaa6a73b370711be8b1eb`
  (`ai.allplays.lite`): link Play Integrity to the same Cloud project, register
  release and Play signing SHA-256 fingerprints, and choose integrity settings
  matching the real distribution channels.

Native debug/simulator runs need Firebase App Check debug tokens. The documented
`npm run mobile:build:ios` and `npm run mobile:build:android` commands use the
explicit `native-debug` Vite build mode, which asks the native SDK to generate a
platform registration token. Use only an isolated development project and its
approved registration process. A simulator/debug-token test cannot prove
production App Attest or Play Integrity. Do not put the generated token in an
environment file or build command.

`npm run app:build`, `npm run mobile:sync`, and all CI/deployment workflows stay
in production mode. They fail closed if a web debug value or the native-debug
opt-in is present; only the local native debug scripts can select the bypass
provider.

## Compatibility verification

1. Release approved clients while preserving existing enforcement settings.
2. Confirm `globalThis.__ALLPLAYS_APP_CHECK_STATUS__` reaches `token-ready` on:
   - Safari and Chrome on `allplays.ai`;
   - a fresh iOS release/TestFlight build on a physical device;
   - a fresh Android internal-test build installed through its intended channel;
   - registered local debug browsers/devices used by CI and developers.
3. Exercise email/password and Google sign-in, invitation redemption, team and
   roster CRUD, image upload, push registration, Stripe checkout redirects,
   AI chat/import/wrap-up, public schedules, live tracking, video embeds, and the
   external scoreboard iframe.
4. In App Check metrics, investigate every unknown or invalid client. Assess
   compatibility before approving any additional protection requirement; do not
   turn off existing protection to accommodate an incompatible client.
5. Keep a rollback owner available and record baseline error/quota rates.

## Staged enforcement

The historical staged rollout order below is a planning reference for separately
approved additions to protection, not an instruction to alter live settings.
Preserve existing enforcement and repeat the smoke matrix after each approved step:

1. Firebase AI Logic baseline protection. Also enable authenticated-users mode
   after verifying every AI entry point requires a signed-in Firebase user.
2. Callable Cloud Functions that use the Firebase callable protocol.
3. Cloud Firestore.
4. Primary-project Cloud Storage, if/when used.
5. Firebase Authentication last, because enforcement can block older installed
   clients during sign-in and recovery.

The separate `game-flow-img` Firebase project uses a named web app and anonymous
auth. Do not enforce App Check for that project's Storage or Authentication until
it has its own reCAPTCHA Enterprise registration and the Capacitor behavior has
been validated, or image storage has been migrated to the primary project.

Firebase Console App Check enforcement for Cloud Functions applies to callable
functions. Tokenized public HTTP endpoints such as calendar feeds must remain
unenforced/exempt unless their backend explicitly verifies the
`X-Firebase-AppCheck` token and has a compatibility/rollback plan. The clients
attach the primary token to known primary-project REST calls where available,
but sending a header alone does not enforce or validate it server-side.

Current AI callers request baseline App Check session tokens. Replay protection
requires limited-use tokens and compatible SDK/provider support across web and
the native bridge. Inspect the live replay-protection mode as part of diagnosis;
the public runtime configuration does not reveal it. If replay protection is
already active, preserve it and treat limited-use-token compatibility as a
release prerequisite. Do not change its mode to work around a failed request.
Any SDK/provider upgrade must be tested across current web and native releases.

## Rollback

If legitimate clients receive `401`, `403`, `appCheck/fetch-status-error`, or
`unauthorized-app` errors, preserve enforcement and diagnose the exact provider,
app version, and baseline/replay-protection requirements. Use App Check metrics
plus the `allplays:app-check-status` browser event without recording tokens.
An approved client rollback is appropriate only if the prior artifact remains
compatible with the active protection policy. Provider/configuration repairs and
releases require separate operator authorization. Until a verified client is
available, retain manual entry and deterministic CSV imports; do not disable
enforcement, strip rejected tokens, or register production debug tokens.
