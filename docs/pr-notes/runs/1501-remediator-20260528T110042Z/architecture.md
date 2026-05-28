# Architecture

## Decision
- Keep one shared `enablePushNotificationsForUser` entry point.
- Preserve native push through `@capacitor-firebase/messaging`.
- Load `../../../../js/push-notifications.js` with `await import(...)` only inside `!Capacitor.isNativePlatform()`.

## Risk And Blast Radius
- The change removes a native startup dependency on the legacy helper and its remote Firebase Messaging import.
- Web behavior remains coupled to the existing helper, limiting blast radius to import timing rather than push implementation.

## Rollback
- Revert this commit if web push registration breaks, but that would reintroduce native startup risk. Preferred fallback would be an app-local web push adapter.
