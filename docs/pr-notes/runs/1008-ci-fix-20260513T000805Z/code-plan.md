# Code Plan

1. Add no-op `grantStreamScoreAccess` and `revokeStreamScoreAccess` exports to the db stub used by `team-schedule-calendar.spec.js`.
2. Stub `player-tracking-summary.js` and `team-staff-permissions.js` in the same smoke fixture so `team.html` imports resolve without pulling unrelated production modules into this isolated schedule test.
3. Re-run the affected Playwright smoke spec.
