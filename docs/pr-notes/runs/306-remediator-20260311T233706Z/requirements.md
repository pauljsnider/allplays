Objective: resolve the three open review threads on lineup publish behavior in `game-day.html` with the smallest safe change.

Current state:
- Publish posts a team chat message before `updateGame(...)` succeeds.
- Notification failure is only logged to the console.
- Publish/draft payloads use `state.gamePlan`, which can lag behind the subscribed game document.

Required outcome:
- Only send the publish chat message after the lineup is persisted.
- If persistence succeeds but chat notification fails, keep the publish successful and show a user-facing warning.
- Base publish/draft versioning and previous published lineup comparisons on the latest persisted game-plan state.
