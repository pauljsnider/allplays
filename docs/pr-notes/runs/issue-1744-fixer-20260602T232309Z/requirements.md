# Requirements

## Acceptance Criteria
- Tapping `liveChat` opens `/messages/:teamId` in the Capacitor app.
- Tapping `liveScore` opens `/games/:gameId`.
- Tapping `schedule` opens `/schedule/:teamId/:eventId`, or `/schedule?teamId=:teamId` when only team context exists.
- Foreground, background, and cold-start notification taps resolve to the same in-app destination.
- Legacy web push behavior stays intact through existing `link` and `webpush.fcmOptions.link` fields.

## Edge Cases
- Missing payload fields fall back to safe in-app routes, never legacy pages in native flows.
- Pre-event reminder pushes that still point at `game-day.html` must resolve to schedule detail in the app.
- If auth is still hydrating, the route intent is preserved until routing can complete.

## Non-Goals
- No notification copy or preference changes.
- No new notification categories.
- No native app-link or universal-link rollout in this slice.
