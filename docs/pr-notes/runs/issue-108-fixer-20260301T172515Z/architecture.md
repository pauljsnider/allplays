# Architecture role synthesis

## Decision
Extract recipient-selection logic into a tiny pure module used by `js/live-tracker.js`.

## Why
- Improves testability without introducing framework/runtime changes.
- Keeps patch minimal and avoids heavy integration harness around DOM + Firebase page script.

## Design
- New module: `js/live-tracker-email.js`
- Export `resolveSummaryRecipient({ teamNotificationEmail, userEmail })`
- Normalize inputs by trimming; return team email first, else user email, else empty string.
- Import in `live-tracker.js` and use in `finishAndSave()` `mailto` construction.

## Controls / rollback
- One call-site swap; rollback is single-commit revert.
- No schema/API contract changes.
