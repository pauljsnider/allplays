# Native authentication hardening rollout

## Status: hold — do not merge or deploy

This change deliberately remains a draft until the release-link identities and
device validation below are complete. The database may contain test data, but
authentication credentials and account boundaries are still security-sensitive.

## What changes

- Firebase Auth state in iOS/Android moves from plaintext WebView storage to
  iOS Keychain / Android Keystore-backed secure storage.
- The existing Firebase IndexedDB record is retained only as an automatic,
  one-time migration source. Firebase then removes the old persistence copy.
- The native REST fallback, image-upload anonymous session, and persisted
  native app-data cache use the same secure-storage boundary. Browser cache
  data is session-scoped.
- Logout removes the secure Firebase record, fallback session, image session,
  Firebase IndexedDB record, and user-scoped app-data cache. A non-secret
  signed-out marker prevents restoration if secure deletion temporarily fails.
- Direct native Firebase REST calls reject emulator/prod crossover, foreign
  project configuration, mismatched UID/profile responses, expired or
  wrong-project token claims, browser credential attachment, redirects, and
  reusable HTTP cache storage.
- Native deep links accept hosted app links only over HTTPS. Hijackable custom
  schemes cannot deliver Firebase action codes, and cold-start URLs are handled
  after the listener is registered.

Client token decoding is a consistency check, not signature verification.
Firestore rules and server/callable token verification remain the authority for
every privileged data operation.

## Required release blockers

1. Replace `REPLACE_WITH_APPLE_TEAM_ID` in
   `.well-known/apple-app-site-association` with the real production Apple Team
   ID and verify that the signed app uses `ai.allplays.lite`.
2. Replace `REPLACE_WITH_RELEASE_CERT_SHA256_FINGERPRINT` in
   `.well-known/assetlinks.json` with the SHA-256 fingerprint of the actual
   Android release/app-signing certificate.
3. Do **not** publish a debug-keystore fingerprint. If Google Play App Signing
   is used, use the app-signing certificate shown by Play, not an upload or
   local debug certificate.
4. Serve both association files from `https://allplays.ai/.well-known/` with
   HTTP 200, no redirect, and the correct JSON content type. Confirm association
   on freshly installed release builds.
5. Complete security review and remove the PR hold only after all device and
   upgrade tests below pass against a non-production test account.

## Device validation matrix

Run on at least one supported physical iPhone/iPad and Android device, plus the
CI simulator/emulator builds:

| Scenario | Expected result |
| --- | --- |
| Upgrade while signed in with email/password | Existing IndexedDB session migrates once; app remains signed in; Firestore-backed screens load; no auth token remains in WebView storage. |
| Upgrade while signed in with Google | Same as email/password; account picker and existing-account behavior remain unchanged. |
| Fresh email/password, Google, signup, and email-link login | Sign-in completes, survives a process kill, and restores the correct Firebase `currentUser`. |
| Force-close with Keychain/Keystore unavailable or locked | No plaintext fallback is created; app fails signed out or uses only the current process's in-memory session. |
| Logout with secure deletion failure | UI and app-data cache clear immediately; the signed-out marker prevents a stale secure token from restoring. |
| Sign out user A, sign in user B | No schedule, fee, team, profile, message, or image-session data from user A appears for user B. |
| Delete account | Server deletion runs first; local secure sessions and caches are cleared even if the request fails after deletion. |
| Expired/rotated refresh token | Refresh succeeds only for the configured project and UID; invalid refresh forces reauthentication without leaking a token to logs. |
| Auth emulator configured in a native build | Direct production REST auth is blocked before any network request. |
| HTTPS universal/app link while running and cold-started | Intended internal route opens once. |
| Custom-scheme reset/verify link | Rejected; no `oobCode` reaches the app through the unverified scheme. |
| HTTPS reset/verify link after association is complete | Firebase validates the one-time code and expiry; malformed/oversized codes are rejected locally first. |

Also inspect Safari Web Inspector / Android WebView storage after login and
logout. The legacy keys `allplays-native-auth-session`, image auth records,
Firebase `authUser` IndexedDB record, and durable email/invite hints must be
absent after migration/cleanup.

## Rollback

Rollback requires a new native release; do not simply remove the secure-storage
plugin from an already-shipped binary. Keep the secure reader and logout cleanup
for at least one release if auth behavior is reverted, so users can be signed
out cleanly and old Keychain/Keystore entries can be removed. Never migrate
tokens back into localStorage or IndexedDB as a rollback mechanism.
