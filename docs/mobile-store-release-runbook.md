# ALL PLAYS Mobile Store Release Runbook

This runbook takes `ai.allplays.lite` from the repository to TestFlight, Google Play internal testing, and store review. Complete it in order. Do not enable production upload until internal testers have completed the release checklist.

## Release decisions already made

- Store name: **ALL PLAYS**
- Bundle/application ID: `ai.allplays.lite`
- First release version: `1.0.0`
- iOS login: email/password, Google, and Apple
- Android login: email/password and Google
- Payments: disabled for the initial release
- Account deletion: Profile → Security → Delete account
- Public legal URLs:
  - `https://allplays.ai/privacy.html`
  - `https://allplays.ai/terms.html`
  - `https://allplays.ai/support.html`
  - `https://allplays.ai/account-deletion.html`

## Phase 1 — Developer accounts

Create or verify the `support@allplays.ai` mailbox first, send a message to it from an unrelated address, and confirm someone owns the response queue. This address is published in the app and store-facing legal pages.

### Apple

1. Enroll in the Apple Developer Program as the legal organization that should appear as the App Store seller.
2. Confirm the account has an active $99/year membership.
3. Add at least one additional trusted administrator.
4. In App Store Connect, accept outstanding agreements.
5. Record the 10-character Apple Team ID.

### Google

1. Create or verify a Google Play organization developer account.
2. Complete identity, phone, email, website, and D-U-N-S verification.
3. Add at least one additional trusted administrator.
4. Create the app in Play Console with package name `ai.allplays.lite`.
5. Complete required developer-verification and app-content tasks.

## Phase 2 — Apple identifiers and Sign in with Apple

1. In Apple Developer → Certificates, Identifiers & Profiles, create or open the explicit App ID `ai.allplays.lite`.
2. Enable:
   - Associated Domains
   - Push Notifications
   - Sign in with Apple
3. Configure Sign in with Apple as the primary App ID when prompted.
4. In Firebase Console → Authentication → Sign-in method, enable Apple.
5. Create an Apple Sign in key and configure Firebase with its Team ID, Key ID, private key, and service ID where requested.
6. Add the production iOS app in Firebase using bundle ID `ai.allplays.lite`; verify the checked-in `GoogleService-Info.plist` belongs to that app.
7. Create an Apple Distribution certificate.
8. Create an App Store provisioning profile for `ai.allplays.lite` containing the enabled capabilities.
9. Export the distribution certificate and private key as a password-protected `.p12`.

## Phase 3 — Android signing and Firebase

1. In Play Console, enable Play App Signing.
2. Generate a dedicated upload key:

   ```sh
   keytool -genkeypair -v \
     -keystore allplays-upload.jks \
     -alias allplays-upload \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

3. Store the keystore and passwords in a password manager. Losing the upload key creates an account-recovery process.
4. Add the Android Firebase app with package name `ai.allplays.lite`.
5. Add SHA-256 fingerprints for:
   - Local debug certificate
   - GitHub Actions upload certificate
   - Google Play App Signing certificate
6. Download a fresh `google-services.json` if Firebase configuration changed.
7. Enable Google authentication in Firebase.

The account-deletion worker runs in the primary `game-flow-c6311` Firebase project but must also delete profile photos from `game-flow-img`. Before releasing, grant the Functions runtime service account object-admin access to that image bucket:

```sh
gcloud storage buckets add-iam-policy-binding gs://game-flow-img.firebasestorage.app \
  --member=serviceAccount:game-flow-c6311@appspot.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

Verify the binding and complete a non-owner account-deletion test with a new
UID-scoped profile photo.

Legacy `user-photos/<timestamp>_<name>` objects cannot be deleted from a
user-controlled `photoUrl`: that prefix also contains certificate signatures
and the old objects have no trusted owner metadata. Before store submission,
inventory those unscoped objects, establish ownership from a trusted export or
Storage audit source, migrate confirmed current profile photos into
`user-photos/<uid>/...`, and remove confirmed orphaned objects in a separately
approved cleanup window. Do not make the account-deletion worker infer legacy
ownership from a profile URL. Treat any remaining unscoped profile photo as a
release blocker.

## Phase 4 — Verified app links

### iOS

Replace `REPLACE_WITH_APPLE_TEAM_ID` in `.well-known/apple-app-site-association` with the real Team ID. Deploy it and verify:

```sh
curl -i https://allplays.ai/.well-known/apple-app-site-association
```

The response must be HTTPS, return `200`, not redirect, and contain:

```text
APPLE_TEAM_ID.ai.allplays.lite
```

### Android

Copy the SHA-256 fingerprint for the Google Play App Signing certificate—not only the upload certificate—into `.well-known/assetlinks.json`. Deploy and verify:

```sh
curl -i https://allplays.ai/.well-known/assetlinks.json
```

## Phase 5 — GitHub release environment

Create a protected GitHub environment named `mobile-release`. Require approval from a repository administrator. Add these environment secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64 of `allplays-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `allplays-upload` or chosen alias |
| `ANDROID_KEY_PASSWORD` | Key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play publishing service-account JSON |
| `IOS_DISTRIBUTION_CERTIFICATE_BASE64` | Base64 of distribution `.p12` |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | `.p12` export password |
| `IOS_APP_STORE_PROFILE_BASE64` | Base64 of App Store `.mobileprovision` |
| `IOS_TEAM_ID` | Apple Team ID |
| `APP_STORE_CONNECT_KEY_ID` | App Store Connect API key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect issuer ID |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Full `.p8` private-key text |

On macOS, create single-line base64 values with:

```sh
base64 -i allplays-upload.jks | tr -d '\n'
base64 -i distribution.p12 | tr -d '\n'
base64 -i ALL_PLAYS_App_Store.mobileprovision | tr -d '\n'
```

Do not commit any signing file, password, service-account JSON, or private key.

For Google API upload, first create the app and manually upload the first bundle in Play Console. Then create a Google Cloud service account, enable the Google Play Android Developer API, and grant that account release permission in Play Console → Users and permissions.

## Phase 6 — First CI build

1. Merge the release changes to the protected default branch.
2. Open GitHub → Actions → `mobile-release` → Run workflow.
3. Enter `1.0.0`.
4. Leave both upload switches off.
5. Approve the `mobile-release` environment.
6. Download and retain the generated `.aab` and `.ipa` artifacts.
7. Confirm the workflow build number appears as:
   - Android `versionCode`
   - iOS `CFBundleVersion`

After the artifact-only build succeeds, run it again with:

- `upload_android`: enabled, after the first manual Play bundle exists.
- `upload_ios`: enabled, after the App Store Connect app record exists.

Uploads go only to Play internal testing and TestFlight.

## Phase 7 — Internal release checklist

Use a clean test parent, coach, and team-owner account. Do not give reviewers a personal production account.

- Fresh install and upgrade install
- Email/password sign-up and sign-in
- Google sign-in on both platforms
- Apple sign-in on iOS, including Hide My Email
- Password reset and email verification
- Invitation redemption
- Parent, coach, and admin navigation
- Team creation and ownership-transfer path
- Schedule and game deep links
- Camera and photo-library permissions
- Voice dictation permission and denial recovery
- Push opt-in, foreground receipt, background receipt, and tap routing
- Offline fee instructions with no Stripe button or checkout
- User content report/moderation behavior
- Account deletion for a non-owner
- Account deletion blocked for a team owner with actionable instructions
- Privacy, terms, support, and deletion links
- Accessibility: large text, VoiceOver/TalkBack labels, contrast, and keyboard focus
- Poor network, offline launch, expired session, and forced sign-out
- Crash-free run on at least one older and one current OS device per platform

## Phase 8 — Store records

### App Store Connect

1. Create the app using bundle ID `ai.allplays.lite`.
2. Category: Sports.
3. Set the age rating honestly for messaging, user-generated content, and unrestricted web content. Do not choose Apple’s Kids category without a separate legal/product review.
4. Add privacy-policy and support URLs.
5. Complete the privacy label for all app and third-party collection, including account/contact data, user content, identifiers, usage data, diagnostics, and performance data where applicable.
6. Add screenshots for the required iPhone and iPad sizes.
7. Provide reviewer notes explaining:
   - Accounts are for authorized adults.
   - Athlete data can describe minors and is private by default.
   - Payments are disabled in version 1.0.
   - How to use the parent, coach, and team-owner review accounts.
   - How to find reporting, moderation, and account deletion.
8. Select the processed TestFlight build and submit.

### Google Play Console

1. Complete App access with permanent reviewer credentials and exact steps.
2. Complete Ads, Content rating, Target audience, News, Data safety, and account-deletion declarations.
3. Set the deletion URL to `https://allplays.ai/account-deletion.html`.
4. Add the privacy-policy URL.
5. Upload icon, phone/tablet screenshots, short description, full description, and feature graphic.
6. Release to internal testing, then closed testing.
7. If the account is a new personal account, keep at least 12 testers continuously opted in for 14 days before applying for production access.
8. Promote the tested build to production only after pre-launch reports and review warnings are clear.

## Competitor-informed choices

The initial policy and deletion experience follows the useful patterns in TeamSnap and GameChanger:

- Account deletion is discoverable in account settings.
- Deletion is permanent and requires an explicit confirmation.
- Team owners must transfer ownership or retire/deactivate teams first.
- The adult login is distinguished from team/player history controlled by the team.
- Privacy material explicitly covers youth-sports information, team administrators, user content, service providers, retention, and support contacts.

ALL PLAYS should not copy competitor wording, branding, screenshots, or store metadata. The goal is equivalent clarity and safety, not imitation.

## Release ownership

Code can automate builds and uploads. The account holder must personally complete identity verification, legal agreements, tax/banking questions if applicable, privacy questionnaires, age/target-audience declarations, review-account creation, signing-key custody, and final store submission approval.
