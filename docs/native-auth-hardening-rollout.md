# Native authentication hardening rollout

## Status: hold — do not merge or deploy

This change deliberately remains a draft until the release-link identities and
device validation below are complete. The database may contain test data, but
authentication credentials and account boundaries are still security-sensitive.

## What changes

- Firebase Auth state in iOS/Android moves from plaintext WebView storage to
  iOS Keychain / Android Keystore-backed secure storage.
- The existing Firebase IndexedDB record is retained only as an automatic,
  one-time migration source while no signed-out tombstone exists. A tombstoned
  launch omits IndexedDB from Firebase's persistence hierarchy until a fresh
  secure credential is written, so failed cleanup cannot restore an old user.
- The native REST fallback, image-upload anonymous session, and persisted
  native app-data cache use the same secure-storage boundary. Browser cache
  data is session-scoped.
- Native boot eagerly consumes the legacy fallback-auth and image-upload
  localStorage records before the first runtime await. Valid values migrate to
  secure storage when it is available; unavailable secure storage removes the
  plaintext and restores nothing. A Firebase SDK/IndexedDB user remains
  authoritative, and a fallback credential for a different UID is discarded.
- Logout removes the secure Firebase record, fallback session, image session,
  Firebase IndexedDB record, and user-scoped app-data cache. A non-secret
  signed-out marker prevents restoration if secure deletion temporarily fails.
  Native auth mutations and same-key secure-storage operations are serialized
  so delayed cleanup for user A cannot delete a replacement session for user B.
- Direct native Firebase REST calls reject emulator/prod crossover, foreign
  project configuration, mismatched UID/profile responses, expired or
  wrong-project token claims, browser credential attachment, redirects, and
  reusable HTTP cache storage.
- Native deep links accept hosted app links only over HTTPS. Hijackable custom
  schemes cannot deliver Firebase action codes, and cold-start URLs are handled
  after the listener is registered.
- This release seeds a device-only secure install marker plus a matching
  WebView marker. The seed/observe phase never removes an auth session for a
  missing or mismatched marker, so an unknown legacy upgrade cannot be mistaken
  for an iOS reinstall.
- Auth profile hydration uses one monotonic generation across observer events,
  explicit refresh, sign-out, and unmount. A late result can commit only when
  its generation and UID still match the latest observed Firebase identity.

Client token decoding is a consistency check, not signature verification.
Firestore rules and server/callable token verification remain the authority for
every privileged data operation.

## Required release blockers

The two association files remain source-only placeholders. Production Pages,
Firebase Hosting staging, trusted preview extraction, deploy verification, and
staged-artifact smoke tests all exclude them. Keep the live endpoints at an
honest 404 until both real identities are available; do not publish placeholder
claims.

1. Replace `REPLACE_WITH_APPLE_TEAM_ID` in
   `.well-known/apple-app-site-association` with the real production Apple Team
   ID and verify that the signed app uses `ai.allplays.lite`.
2. Replace `REPLACE_WITH_RELEASE_CERT_SHA256_FINGERPRINT` in
   `.well-known/assetlinks.json` with the SHA-256 fingerprint of the actual
   Android release/app-signing certificate.
3. Do **not** publish a debug-keystore fingerprint. If Google Play App Signing
   is used, use the app-signing certificate shown by Play, not an upload or
   local debug certificate.
4. In a separate identity-complete release change, intentionally allow both
   association files into the staged artifact and serve them from
   `https://allplays.ai/.well-known/` with HTTP 200, no redirect, and the correct
   JSON content type. Confirm association on freshly installed release builds.
5. Complete and physically validate the two-release iOS uninstall/reinstall
   migration below. The secure-storage dependency documents that iOS Keychain
   entries survive app deletion, while WebView storage does not.
6. Complete security review and remove the PR hold only after all device and
   upgrade tests below pass against a non-production test account.

## Two-release iOS reinstall migration

### Release 1: seed and observe (this change)

- Use the protocol-isolated `seed-observe-v2-web-first` value and v2 secure/Web
  keys. Pre-release v1 markers are never enforcement evidence.
- Treat no marker as an unknown legacy/fresh install and seed both boundaries
  without signing out.
- Read secure storage first. A failed read or unknown secure version performs
  no writes. When the v2 secure marker is absent, require readable WebView
  storage, write and verify the Web marker synchronously, and only then start
  the secure write.
- Never roll back a verified Web marker after a secure hard failure or timeout.
  Native plugin calls cannot be cancelled and may complete later; rollback
  could manufacture a secure-only marker. Web-only is always passive and a late
  secure completion safely produces the full pair.
- If the secure marker exists while the WebView marker is absent or mismatched,
  record the observe result and realign the WebView marker without deleting the
  Firebase Auth record or fallback session. This preserves a possible legacy
  upgrade or same-device reinstall during the adoption window.
- Preserve unknown secure marker versions and treat secure/WebView storage
  failures as unavailable state, never as evidence of reinstall.
- Keep logout and account-deletion cleanup independent. They continue removing
  the secure Firebase record, fallback session, IndexedDB state, image session,
  and user caches; the opaque install marker is not an account credential.

#### Release 1 marker failure matrix

| Initial/read state | Operation result | Durable state after the attempt | Release 2 eligibility |
| --- | --- | --- | --- |
| Secure read unavailable | No Web or secure write | Existing values unchanged | Never infer reinstall |
| Unknown secure version | No Web or secure write | Unknown version preserved | Never infer reinstall |
| v2 secure absent; Web unavailable/write fails/verification fails | No secure write | None or Web-only | Never infer reinstall |
| v2 secure absent; Web verified; secure write fails before start | Keep Web marker | Web-only | Never infer reinstall |
| v2 secure absent; Web verified; secure write times out after start | Keep Web marker while native call settles | Web-only, then possibly full pair | Never infer reinstall while Web exists |
| v2 secure present; Web matches | No write | Full pair | Normal installed state |
| v2 secure present; Web missing/mismatched | Repair Web only; never touch auth | Full pair if repair succeeds | Release 1 never purges |
| v2 secure present; Web repair unavailable/fails | No auth or secure mutation | Secure-only preexisting state | Release 1 never purges; Release 2 remains separately gated |

### Release 2: enforce only after adoption and physical validation

- Ship only after Release 1 has had an explicit adoption window and its upgrade,
  logout, account-deletion, and reinstall matrix passes on physical devices.
- Before Firebase persistence initialization, classify reinstall only when the
  secure marker is the exact `seed-observe-v2-web-first` value, WebView storage
  is readable, the matching v2 WebView marker is absent, and the physical
  Release 1 adoption evidence has ruled out partial/legacy rollout state.
- Never purge for a missing/unknown secure marker, an unrecognized version, or
  an unreadable Keychain/Keystore/WebView boundary. In particular, a v1 marker
  is unknown and can never authorize purge.
- On a positively classified reinstall, remove the secure Firebase and fallback
  auth sessions before Firebase can restore them, then establish the new local
  marker. Add fault-injection coverage for late writes and failed removals before
  enabling enforcement.

This staged design deliberately does not retroactively purge a reinstall that
occurs during Release 1. Its purpose is to preserve unknown existing users while
establishing an unambiguous boundary for future reinstalls.

## Device validation matrix

Run on at least one supported physical iPhone/iPad and Android device, plus the
CI simulator/emulator builds:

| Scenario                                                   | Expected result                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrade while signed in with email/password                | Existing IndexedDB session migrates once; app remains signed in; Firestore-backed screens load; no auth token remains in WebView storage.                                                                |
| Upgrade while signed in with Google                        | Same as email/password; account picker and existing-account behavior remain unchanged.                                                                                                                   |
| Boot with SDK user B plus legacy fallback user A plaintext | Plaintext is removed immediately; SDK user B remains displayed/authoritative; fallback A is deleted and cannot appear after a later null observer snapshot.                                               |
| Boot with legacy image-upload plaintext                    | Plaintext is removed immediately and migrates only to secure storage; unavailable secure storage restores nothing and does not affect primary auth.                                                       |
| A profile hydration resolves after null/B/sign-out/unmount | The stale A result makes no user/profile/error/bootstrap-hint change. B or signed-out state remains authoritative.                                                                                        |
| Fresh email/password, Google, signup, and email-link login | Sign-in completes, survives a process kill, and restores the correct Firebase `currentUser`.                                                                                                             |
| Force-close with Keychain/Keystore unavailable or locked   | No plaintext fallback is created; app fails signed out or uses only the current process's in-memory session.                                                                                             |
| Logout with secure deletion failure                        | UI and app-data cache clear immediately; the signed-out marker prevents a stale secure token from restoring.                                                                                             |
| Logout cleanup is delayed, then user B signs in            | User B waits for user A cleanup; no late A removal or Firebase sign-out deletes B. If a same-key native operation times out before starting, B fails closed and a retry succeeds after storage recovers. |
| Sign out user A, sign in user B                            | No schedule, fee, team, profile, message, or image-session data from user A appears for user B.                                                                                                          |
| Delete and reinstall on iOS during seed/observe release    | Existing secure auth may restore; the app records/reseeds the WebView marker and never signs out solely because the marker was absent. Validate this passivity behavior before designing Release 2 enforcement. |
| Delete and reinstall on iOS during later enforcement release | Only an exact known secure seed plus a readable missing WebView marker may trigger pre-auth secure-session purge. Unknown/unavailable marker state must preserve the session and fail without destructive inference. |
| Delete account                                             | Server deletion runs first; local secure sessions and caches are cleared even if the request fails after deletion.                                                                                       |
| Expired/rotated refresh token                              | Refresh succeeds only for the configured project and UID; invalid refresh forces reauthentication without leaking a token to logs.                                                                       |
| Auth emulator configured in a native build                 | Direct production REST auth is blocked before any network request.                                                                                                                                       |
| HTTPS universal/app link while running and cold-started    | Intended internal route opens once.                                                                                                                                                                      |
| Custom-scheme reset/verify link                            | Rejected; no `oobCode` reaches the app through the unverified scheme.                                                                                                                                    |
| HTTPS reset/verify link after association is complete      | Firebase validates the one-time code and expiry; malformed/oversized codes are rejected locally first.                                                                                                   |

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

The phase-one install marker is opaque, non-secret, and safe to leave in place
during rollback. Do not ship phase-two reinstall enforcement unless the phase-one
reader remains available for rollback and recovery builds.
