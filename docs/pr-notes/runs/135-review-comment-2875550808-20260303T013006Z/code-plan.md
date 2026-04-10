# Code Role Plan

## Thinking Level
low: single-file security patch with narrow blast radius.

## Patch
1. Add config read for `calendar.service_account`.
2. Build conditional runtime options object.
3. Replace hardcoded `runWith({ serviceAccount: ... })` with `runWith(fetchCalendarRuntime)`.

## Rollback
- Revert commit if deployment unexpectedly requires fixed service account.
- Restore behavior by setting Firebase config rather than re-hardcoding source.
