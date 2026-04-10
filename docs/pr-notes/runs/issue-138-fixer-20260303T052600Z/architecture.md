# Architecture Role Output

## Current-State Read
`startEditPractice` writes UTC-formatted strings via `toISOString().slice(0, 16)` into `datetime-local` inputs. Browser treats input as local wall time on submit, causing timezone-offset drift on resave.

## Proposed Design
Reuse existing in-file helper `formatIsoForInput()` for practice start/end prefill to normalize Date/Timestamp into local-input-safe text.

## Files And Modules Touched
- `edit-schedule.html`
- `tests/unit/edit-schedule-practice-timezone.test.js`

## Data/State Impacts
No schema changes. Stored timestamps continue through `Timestamp.fromDate(...)`; only input prefill string construction changes.

## Security/Permissions Impacts
No access control or tenant boundary changes.

## Failure Modes And Mitigations
- Risk: helper misuse/regression later. Mitigation: unit test asserts `startEditPractice` uses helper and avoids UTC slicing.
