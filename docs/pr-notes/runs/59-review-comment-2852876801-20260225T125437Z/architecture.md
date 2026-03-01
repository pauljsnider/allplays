# Architecture Role Notes

## Decision
Use a minimal state-transition fix rather than introducing new state fields.

## Why
- Existing warning gate already keys off `isFinishing`.
- Reordering one assignment restores previous control behavior with minimal regression risk.

## Controls and Equivalence
- Data integrity control strengthened: user remains guarded against navigation while persistence is in flight.
- Access/security model unchanged: no auth/rules/data-model changes.

## Rollback
Revert the single-line move in `js/live-tracker.js` if unexpected UX side effects appear.
