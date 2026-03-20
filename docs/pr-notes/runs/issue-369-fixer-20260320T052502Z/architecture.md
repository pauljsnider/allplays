# Architecture Role (allplays-architecture-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-architecture-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent architecture analysis.

## Current state
`edit-schedule.html` owns schedule creation directly and already integrates existing DB helpers plus notification helpers. Bulk AI logic is inline and normalizes add/update/delete operations before write.

## Proposed state
- Add a new pure helper module `js/schedule-csv-import.js` for:
  - CSV tokenization
  - header alias matching
  - mapping validation
  - row normalization
  - row-level validation
- Add a new CSV tab in `edit-schedule.html` that:
  - reads the uploaded file client-side
  - renders mapping selects from parsed headers
  - renders an editable preview with validation errors
  - commits valid rows through existing schedule writers

## Blast radius
- New helper module is isolated and unit-testable.
- `edit-schedule.html` gets a bounded UI addition and import handler.
- Firestore schema does not change.

## Controls
- File stays local in-browser until explicit save.
- Import is blocked when any preview row is invalid.
- Notifications remain opt-in.
- Existing add/edit schedule flows remain unchanged.

## Tradeoff
This path does not attempt upsert or dedupe logic. That keeps the change safe and reviewable while delivering deterministic import behavior.
