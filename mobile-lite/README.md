# ALL PLAYS Mobile App

This folder contains the Capacitor WebView app. The mobile app uses the existing ALL PLAYS HTML/JS pages as bundled first-class routes, with a small native adapter for iOS/Android behavior.

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

## Current MVP surface

- `index.html`: minimal app login/boot screen.
- `parent-dashboard.html`: signed-in home screen for parents.
- `calendar.html`: schedule and RSVP flow.
- `team-chat.html`: team messaging from linked teams.

The app does not use iframes for the MVP surface. iOS and Android share the same bundled pages and shared JS modules; platform differences stay in Capacitor/Firebase config and the native adapter.

## Native scope

- Included now: email/password login, password reset, shared app-mode routing, and native Google sign-in when the Capacitor Firebase Authentication plugin is available.
- Deferred: push notifications and store-specific notification preferences.

## Firebase native app notes

The native projects currently keep the registered package and bundle identifier `ai.allplays.lite` so the checked-in Firebase native config files continue to match local builds.

Before TestFlight or store submission, register final production native Firebase apps, replace:

- `ios/App/App/GoogleService-Info.plist`
- `android/app/google-services.json`

Then update the matching native identifiers in:

- `capacitor.config.json`
- `ios/App/App.xcodeproj/project.pbxproj`
- `android/app/build.gradle`
- `android/app/src/main/java/.../MainActivity.java`
- `android/app/src/main/res/values/strings.xml`

Keep Firebase Web API key restrictions aligned with local web testing and the native WebView origin `capacitor://localhost/*`.
