# Chat AI Assistant (@ALL PLAYS)

## Summary
Add an @ mention in team chat that lets users ask questions to an AI assistant ("ALL PLAYS"). The assistant responds as a chat message so everyone can see it. Responses are based only on team data and stats.

## UX
- Typing `@` shows a dropdown with **ALL PLAYS**.
- Selecting it inserts `@ALL PLAYS` into the message input.
- When the message is sent, the UI shows a local "ALL PLAYS is thinking…" indicator (only to the sender).
- The assistant reply is stored as a normal chat message with `ai: true` and rendered like a bot user.

## Data Sources
- `teams/{teamId}` (team meta)
- `teams/{teamId}/players` (roster basics)
- `teams/{teamId}/games` (schedule + scores)
- `teams/{teamId}/games/{gameId}/aggregatedStats` (player stats)

## Defaults / Limits
- Stats are aggregated across the **most recent N completed games**.
- Default N: 10 (adjustable).
- Game list in context limited to most recent 20 games.

## Notes
- AI responses are posted with the requesting user's `senderId` to satisfy Firestore rules.
- Rendering uses `ai: true` to show name/avatar as **ALL PLAYS**.
- No private data (medical/emergency contacts) is included in context.

## Future Options
- Replace keyword heuristics with a two-step "tool call" AI router to fetch only needed data.
- Add per-team rate limits or cooldowns.
- Add an unread "assistant replied" badge for the sender.
- Expand mentions to coaches/admins (e.g., `@Coach`), or allow multiple bot commands.
- Add push notifications (FCM) for AI replies.
