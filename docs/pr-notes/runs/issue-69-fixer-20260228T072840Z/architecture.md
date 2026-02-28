# Architecture Role Output (manual fallback)

## Current state
`team-chat.html` advances `chatLastRead` only inside `if (!initialSnapshotLoaded)` in the real-time listener.

## Proposed state
Advance `chatLastRead` on every applied snapshot while user/team context is valid (not just initial snapshot).

## Blast radius
- Read path unchanged.
- Write path: more frequent `users/{uid}.chatLastRead.{teamId}` updates during active chat view.
- No schema/rules/query changes.

## Risk and mitigations
- Risk: increased write frequency.
- Mitigation: only write when there is a valid `currentUser.uid` and current `teamId`; triggered only on message snapshot updates.
