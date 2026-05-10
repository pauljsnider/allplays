# Code Plan

1. Edit `functions/index.js` in `calendarTokenHasTeamAccess`.
2. Remove token-document role/team/member grants from the access decision.
3. Keep the identity fallback fields (`uid`, `email`) because the token identifies the holder, while current access is checked against live team/user documents.
4. Validate syntax with `node --check functions/index.js`.
