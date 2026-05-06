# Code plan

## Change
Update `tests/smoke/team-schedule-calendar.spec.js` so `buildDbStub()` exports `postChatMessage()`.

## Why
The page under test imports the new DB helper. The test stub must match the named export surface or module initialization fails before team and schedule rendering starts.

## Validation
Run the affected Playwright smoke spec against the local static server if Playwright is available. At minimum, run syntax/static inspection and commit only the targeted harness change.
