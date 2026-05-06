# QA Plan

## Automated
- Extend volleyball unit coverage for undo state capture and restore.
- Validate malformed undo data does not restore.

## Manual Regression Targets
- Ace then Undo Last: score and server return to previous state.
- Service error then Undo Last: opponent point and side-out are reversed.
- Home point while away serves then Undo Last: score and serving team restore.
- Repeated Undo Last: walks newest-to-oldest without negative scores.
- Existing generic stat undo still decrements stats and score as before.

## Release Gate
- `unit-tests` must pass for the touched volleyball test file.
- CI checks on the PR must remain green after push.
