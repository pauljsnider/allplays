# Code Role Plan

1. Update `shouldUpdateChatLastRead` to require `hasCurrentUser`, `hasTeamId`, `isPageVisible`, and `isWindowFocused`.
2. Pass `document.visibilityState === 'visible'` and `document.hasFocus()` from Team Chat snapshot callback.
3. Update/add unit tests for both positive and negative focus/visibility scenarios.
4. Run targeted tests and commit minimal patch.

## Conflict resolution
No role conflicts. All roles align on adding visibility + focus gating as the minimal safe patch.
