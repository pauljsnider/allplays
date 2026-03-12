Objective: patch legacy trackers with the smallest control-preserving change.

Current state:
- Recipient selection logic is duplicated in each tracker.
- `js/live-tracker.js` already centralizes the intended fallback in `js/live-tracker-email.js`.

Proposed state:
- Import `resolveSummaryRecipient()` into `track.html` and `js/track-basketball.js`.
- Replace direct `currentUser.email` usage with helper-based recipient selection.

Risk surface and blast radius:
- Small import and call-site changes in two tracker entry points.
- Cache-busting remains unchanged for existing imports except for the newly added helper import.

Tradeoffs:
- Source-level wiring tests are less behavioral than DOM execution tests, but they are stable and sufficient for this regression class in a static HTML app.
- Reusing the helper avoids future drift across tracker implementations.

Rollback:
- Revert the helper imports and recipient call-site substitutions.

Instrumentation:
- Regression is covered by focused unit tests checking helper behavior and wiring in both legacy trackers.
