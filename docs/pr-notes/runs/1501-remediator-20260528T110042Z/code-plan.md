# Code Plan

## Implementation Plan
1. Remove top-level import of `registerPushNotifications` from `apps/app/src/lib/pushService.ts`.
2. Add `const { registerPushNotifications } = await import('../../../../js/push-notifications.js');` inside the non-native branch immediately before use.
3. Update the existing app/profile parity unit test to assert dynamic import and reject static import.
4. Validate focused unit test and app build.

## Notes
- No unrelated native manifest, entitlement, or delegate changes are needed for this review thread.
- No new branch is required. Commit on the current PR branch only.
