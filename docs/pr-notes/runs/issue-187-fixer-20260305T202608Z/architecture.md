# Architecture Role (allplays-architecture-expert equivalent fallback)

Requested skills (`allplays-orchestrator-playbook`, `allplays-architecture-expert`) and `sessions_spawn` are unavailable in this runtime. This file captures equivalent role analysis.

## Current state
- Static web app with Firebase Auth/Firestore.
- No push service worker registration flow in app code.
- Cloud Functions only has `fetchCalendarIcs` HTTP endpoint.

## Proposed state
- Add client push registration module (`js/push-notifications.js`) using Firebase Messaging Web SDK.
- Add service worker (`firebase-messaging-sw.js`) to receive background pushes and route clicks.
- Add per-user/team preferences at `users/{uid}/notificationPreferences/{teamId}`.
- Add per-user device tokens at `users/{uid}/notificationDevices/{deviceId}`.
- Add Cloud Function Firestore triggers:
  - Team chat create -> `liveChat` category
  - Game update score delta -> `liveScore` category
  - Game schedule-significant field changes -> `schedule` category

## Blast radius
- New Firestore subcollections under `users` only.
- New Cloud Function triggers only observe `teams/*` writes already happening.
- No schema migration required; defaults are fail-safe (disabled unless enabled in UI).

## Control equivalence
- Firestore rules enforce owner-only read/write under `users/{uid}/notification*`.
- Dispatch candidates filtered by membership (`owner/admin/parentTeamIds`).
- Token failures pruned from user device docs.
