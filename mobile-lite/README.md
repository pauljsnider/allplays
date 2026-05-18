# ALL PLAYS Lite Mobile Proof

This folder is the smallest Capacitor proof for Firebase Auth in a native shell.

## Local browser test

```bash
npm run mobile:serve
```

Open `http://localhost:8100`.

## Native test

```bash
npm run mobile:sync
npm run mobile:run:ios
npm run mobile:run:android
```

## Firebase referer requirement

The bundled iOS app runs from `capacitor://localhost`. If sign-in shows:

```text
auth/requests-from-referer-capacitor://localhost-are-blocked
```

the Firebase Web API key is rejecting the native WebView origin. In Google Cloud Console, open the API key used by the primary Firebase web app and add this allowed HTTP referrer:

```text
capacitor://localhost/*
```

Keep the existing web entries for `allplays.ai`, `www.allplays.ai`, `localhost`, and `127.0.0.1`.

For production app-store builds, the stronger path is adding iOS and Android apps to the Firebase project and using native Firebase auth config for provider flows such as Google sign-in.

## Dashboard proof

Do not use `https://allplays.ai/dashboard.html` as the first native proof after sign-in. The native shell runs on `capacitor://localhost`, while the hosted web app runs on `https://allplays.ai`, so browser auth persistence is not shared between them.

The lite proof now loads a small in-app dashboard directly from Firestore after sign-in:

- owned teams: `teams.ownerId == currentUser.uid`
- admin teams: `teams.adminEmails` contains the signed-in email
- parent teams: `users/{uid}.parentOf` / `parentTeamIds`
