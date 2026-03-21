Manual test focus:
- Finish a game with a trusted scoring log and mismatched typed final score.
- Confirm the generated `teams/.../events` write set includes the reconciliation note before commit.
- Confirm recap email generation uses a log that includes the reconciliation note.
- Confirm a failed save does not leave a duplicate or orphan reconciliation note in the visible log.

Automated check:
- `npm test -- live-tracker-finish`
