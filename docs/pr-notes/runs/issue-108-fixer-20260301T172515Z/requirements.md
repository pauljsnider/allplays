# Requirements role synthesis

## Objective
Ensure live tracker "Send game summary email on save" targets the team's configured `notificationEmail`, with sensible fallback.

## Current state
`finishAndSave()` composes `mailto:` with `currentUser.email` only.

## Proposed state
Recipient priority is:
1. `currentTeam.notificationEmail` (trimmed, if non-empty)
2. `currentUser.email` (trimmed, if non-empty)
3. empty recipient (existing behavior if neither exists)

## Risk surface / blast radius
- Blast radius is limited to game-completion email compose path in live tracker.
- No Firestore write path changes.
- No auth or access-control behavior changes.

## Assumptions
- `notificationEmail` is already persisted on team document by team settings.
- Existing flow intentionally uses `mailto:` client-side compose and should remain so.

## Recommendation
Implement a small pure helper for recipient selection and unit test priority/fallback behavior.
