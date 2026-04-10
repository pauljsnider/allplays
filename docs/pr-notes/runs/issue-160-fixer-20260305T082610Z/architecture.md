# Architecture Role (synthesized fallback)

Skill/tool note: `allplays-architecture-expert` subagent spawn unavailable; synthesized here.

## Root Cause Hypothesis
Unread derivation depends on `users/{uid}.chatLastRead.{teamId}`. If realtime writes are skipped or missed during transient view-state changes, unread counts remain stale until another message snapshot triggers a write.

## Minimal Safe Change
- Add one helper in `js/team-chat-last-read.js` to decide lifecycle retry eligibility.
- In `team-chat.html`, centralize last-read update into one guarded function and call it from:
  - realtime snapshot callback (existing path)
  - `window.focus`
  - `document.visibilitychange` when visible

## Controls Equivalence
- Access control unchanged (same `updateChatLastRead` call and auth context).
- Blast radius contained to one page and one helper module.
- Rollback is single-file reversion if needed.
