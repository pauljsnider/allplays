# Architecture analysis

## Root cause

`StandardTracker` has no local note-draft state machine. Its existing mutable paths (`recordCell`, `undoLast`, `persistSession`, and the tracking service) intentionally update score/stat/event/session data and are unsafe for an unsaved draft.

## Smallest safe boundary

Add a private `VoiceNoteDraftPanel` in `apps/app/src/pages/StandardTracker.tsx`. Render a keyed instance only inside the established authorized/configured tracker branch. Keep its phase and text in React state and give it no persistence or service callbacks.

Recommended phases are `closed`, `editing`, `recording`, and `reviewing`. Start enters recording; stop enters reviewing; edit enters editing; cancel returns to editing while preserving typed content; discard clears text and closes.

Key the panel by authenticated user, team, and game so a route or principal change destroys the previous in-memory state.

## Authorization

Reuse the loaded event capability boundary: signed-in user, active database game, `canUpdateScore`, and supported legacy tracking engine. Do not add global-role inference. `ScheduleGameHubSection` already hides the Standard Tracker launch through the equivalent gate, so it requires no change.

## Persistence guardrails

The panel must not call or import tracker services, schedule update services, `writeStandardTrackerSession`, browser storage, microphone APIs, speech recognition, wrap-up services, or summary services.

## Required files

- `apps/app/src/pages/StandardTracker.tsx`
- `apps/app/src/pages/StandardTracker.test.tsx`

No `ScheduleGameHubSection.tsx` edit is needed for this self-contained slice.
