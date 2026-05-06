# QA Plan

## Automated
- Run `npm test -- --runInBand` or the repository unit command `npm test` after updating tests.
- Add/adjust unit coverage for:
  - matching same external player ID with same source updates the existing player;
  - same external player ID with different source adds a new player instead of updating;
  - legacy external ID metadata still updates for compatibility;
  - edit roster source contains helper logic that checks legacy import metadata before `Local-only`.

## Manual Inspection
- Inspect `edit-roster.html` rendering logic to confirm imported badge is shown when any supported external ID field exists.
- Inspect `js/edit-roster-registration-import.js` to confirm known source metadata is part of the match key and new payload remains unchanged.
