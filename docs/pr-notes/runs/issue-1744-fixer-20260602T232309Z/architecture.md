# Architecture

## Current State
- Cloud Functions send legacy web URLs in notification payloads.
- The React/Capacitor app registers push tokens but has no notification-open routing layer.

## Proposed State
- Add a canonical `appRoute` plus `eventId` to push payload data while preserving legacy `link` for web push.
- Add native notification-open handling in the app that maps payload data, stores pending route intent, and navigates after auth bootstrap completes.

## Blast Radius
- Backend change is additive to notification payload data.
- App change is isolated to notification routing and startup navigation.

## Rollback
- Revert payload `appRoute` emission and the app notification-open listener.
- Web notification behavior remains unchanged throughout.
