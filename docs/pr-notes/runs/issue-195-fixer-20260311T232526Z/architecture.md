Current architecture:
- `game-day.html` owns lineup editing and persists `gamePlan` through `updateGame(...)`.
- Team notifications already exist as `postChatMessage(...)` writes in Firestore.

Design:
- Add a small pure helper module for lineup publish payloads and notification text.
- Keep `game-day.html` as the integration point: it already has the team, game, roster, and signed-in user context.
- Store these fields on `gamePlan`:
  - `isPublished`
  - `publishedAt`
  - `publishedBy`
  - `publishedByName`
  - `publishedVersion`
  - `publishedLineups`
  - `publishedFormationId`
  - `publishedNumPeriods`
  - `publishedRecipientPlayerIds`
  - `publishedRecipientParentIds`
  - `publishedReadBy`

Why this shape:
- Draft state remains the existing `formationId`, `numPeriods`, and `lineups`.
- A last-published snapshot preserves comparison context and supports future parent/player views.
- `publishedReadBy` seeds read-state tracking without requiring a separate collection.

Notification path:
- On publish, write a system-style team chat message summarizing the lineup publication.
- Use roster player ids plus linked parent user ids as recipient metadata for downstream use.

Rollback:
- Revert the client changes; no data migration required.
