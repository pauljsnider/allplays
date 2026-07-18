# Firebase App Check rollout

App Check client initialization is fail-open by design. Deploying this code starts
attestation and metrics collection but does not reject a request if attestation
fails. Firebase Console enforcement is the separate fail-closed rollout gate.

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
4. For direct builds, the equivalent runtime contract is:

   ```js
   window.__ALLPLAYS_CONFIG__ = {
       appCheck: {
           enabled: true,
           recaptchaEnterpriseSiteKey: 'PUBLIC_ENTERPRISE_SITE_KEY',
           isTokenAutoRefreshEnabled: true
       }
   };
   ```

Local web origins automatically select the Firebase debug provider. Copy the
generated browser debug token from DevTools into Firebase Console > App Check >
Apps > Manage debug tokens. Never commit or share a registered debug token.

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

Native debug/simulator runs need Firebase App Check debug tokens. Enable the
debug provider only in a local build with `VITE_APP_CHECK_DEBUG_TOKEN=true`,
capture the platform token from device logs, and register it in Firebase
Console. Production workflows do not set this variable.

## Compatibility verification before enforcement

1. Deploy the clients while every Firebase API remains **Unenforced**.
2. Confirm `globalThis.__ALLPLAYS_APP_CHECK_STATUS__` reaches `token-ready` on:
   - Safari and Chrome on `allplays.ai`;
   - a fresh iOS release/TestFlight build on a physical device;
   - a fresh Android internal-test build installed through its intended channel;
   - registered local debug browsers/devices used by CI and developers.
3. Exercise email/password and Google sign-in, invitation redemption, team and
   roster CRUD, image upload, push registration, Stripe checkout redirects,
   AI chat/import/wrap-up, public schedules, live tracking, video embeds, and the
   external scoreboard iframe.
4. In App Check metrics, investigate every unknown or invalid client. Do not
   enforce while a supported released client still lacks valid tokens.
5. Keep a rollback owner available and record baseline error/quota rates.

## Staged enforcement

Enable one service at a time and repeat the smoke matrix after each step:

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

The legacy browser surface currently vendors Firebase Web SDK 12.6.0. It sends
baseline App Check session tokens, but Firebase AI Logic replay protection needs
Web SDK 12.14.0 or newer. Keep replay protection disabled until the vendored SDK
is upgraded as one tested unit and AI calls have been verified in current web and
native releases.

## Rollback

If legitimate clients receive `401`, `403`, `appCheck/fetch-status-error`, or
`unauthorized-app` errors, switch the affected API back to **Unenforced** in
Firebase Console. Do not ship a client-side bypass or a production debug token.
Use App Check metrics plus the `allplays:app-check-status` browser event to find
the unregistered app/provider, correct registration, redeploy, and resume the
staged rollout.
