# QA Plan

## Regression Coverage
- Update `tests/unit/app-auth-profile-capabilities.test.js` to fail if `apps/app/src/lib/pushService.ts` statically imports `registerPushNotifications`.
- Assert the web branch dynamically imports `../../../../js/push-notifications.js` before registering web push.

## Validation Commands
- `npx vitest run tests/unit/app-auth-profile-capabilities.test.js --reporter=verbose`
- `npm run app:build`
- Android: run Gradle/assembleDebug when local Android tooling is available. If unavailable on Linux, call out CI/native validation.
- iOS/Xcode: skip on Linux, rely on macOS CI or EAS/Xcode validation.
