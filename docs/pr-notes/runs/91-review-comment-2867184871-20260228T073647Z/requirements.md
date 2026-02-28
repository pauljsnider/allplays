# Requirements Role Notes

## Objective
Prevent `chatLastRead` from advancing unless the user is actively viewing Team Chat.

## User-facing risk
Unread indicators can be cleared while the tab is backgrounded, causing missed messages and trust loss in notification state.

## Acceptance criteria
- `updateChatLastRead` is only called when all are true:
  - authenticated user exists
  - `teamId` exists
  - document visibility is `visible`
  - browser window is focused
- Existing behavior remains unchanged when user is actively reading chat.
- Unit coverage includes non-visible and non-focused states.

## Assumptions
- Team chat page is the only path impacted by this regression.
- `document.visibilityState` and `document.hasFocus()` are available in supported browsers.
