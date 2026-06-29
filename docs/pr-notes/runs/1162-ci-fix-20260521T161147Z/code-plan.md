# Code Plan

## Root Cause
`team-chat.html` now imports `sendTeamEmail` and `getSentTeamEmails` from `./js/db.js?v=76`. The smoke test replaces `js/db.js` with `CHAT_DB_STUB`, but that stub lacks those exports. Browser module import fails before initialization, so the DOM stays at the static `Team-wide` button and `Loading messages...` state.

## Implementation Plan
- Add no-op `sendTeamEmail` and `getSentTeamEmails` exports to `CHAT_DB_STUB` in `tests/smoke/team-fallback-regressions.spec.js`.
- Keep production code unchanged.
- Validate with targeted smoke grep, then full team fallback smoke suite if feasible.
