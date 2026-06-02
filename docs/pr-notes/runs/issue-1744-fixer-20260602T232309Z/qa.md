# QA Plan

## Automated Coverage
- Unit test notification payload-to-route mapping for `liveChat`, `liveScore`, `schedule`, and legacy-link fallback.
- App integration test simulating `notificationActionPerformed` and asserting router navigation to the expected route.
- Static regression test confirming backend payloads include `appRoute` and keep `fcmOptions.link`.

## Manual Smoke
- Install iOS and Android app builds.
- Send one push each for chat, live score, and schedule reminder/change.
- Validate tap behavior from foreground, background, and cold start.

## Pass / Fail
- Pass if each tap lands in-app on the matching route and web push still uses existing website links.
- Fail if any tap opens legacy pages from the native shell or loses route intent during app bootstrap.
