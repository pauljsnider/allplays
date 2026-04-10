# Code Role Notes

## Plan
1. Add `getRsvpSummaries(teamId, gameIds)` in `js/db.js` to compute summaries for many game IDs with shared team cache.
2. Update `calendar.html` hydration loop to call `getRsvpSummaries` per team and reuse results map.
3. Update `parent-dashboard.html` hydration loop similarly.
4. Keep `getRsvpSummary` unchanged for compatibility.
