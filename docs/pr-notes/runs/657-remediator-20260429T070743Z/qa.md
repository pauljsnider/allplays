# QA Plan

- Static syntax validation of `js/edit-schedule-registration-import.js` as an ES module.
- Manual reasoning check: source row with only `startsAt` and matching opponent/title should conflict with an existing unlinked local event instead of producing an add operation.
- Regression check: existing `date`, `start`, and `startTime` source rows still parse through the same code path.
