# Code plan

The requested `allplays-code-expert` skill was unavailable, so this plan applies the assigned minimal-safe-patch implementation role directly.

1. Change the `team-2` access-service fixtures to return `player-2` and `player-3`.
2. After selecting `team-2`, assert the Player chooser is visible, contains both players, and has an empty value.
3. Assert **Send request** is disabled and `window.__accessRequests` is empty.
4. Select `player-3`, assert the button is enabled and the capture is still empty, then submit.
5. Assert the captured request is `{ teamId: 'team-2', playerId: 'player-3', relation: 'Parent' }`.
6. Run the focused Playwright spec and commit the test plus role artifacts. No production change is needed.
