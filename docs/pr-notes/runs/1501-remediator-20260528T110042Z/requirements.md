# Requirements

## Acceptance Criteria
- Native iOS/Android app startup must not evaluate the legacy web push helper or its Firebase Messaging CDN import before the native branch runs.
- Web push registration must continue to use the existing legacy helper only when the platform is non-native.
- Device token persistence remains unchanged for web and native platforms.
- Regression coverage must assert the helper is dynamically loaded and no static top-level helper import remains.

## Actionable Review Thread
- `PRRT_kwDOQe-T586FTYh-`: actionable. Replace the static `registerPushNotifications` import with a dynamic import inside the web-only branch.
