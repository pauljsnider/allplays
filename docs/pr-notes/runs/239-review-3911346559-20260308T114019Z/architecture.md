Decision: fix the counterpart metadata in the pure shared-schedule payload builder instead of patching the downstream Firestore CRUD logic.

Why:
- Lowest blast radius: one field assignment in `js/shared-schedule-sync.js` corrects all create and update callers.
- Preserves the existing source-side contract used by `syncSharedScheduleCounterpart(...)` and `deleteSharedScheduleCounterpart(...)`.
- Keeps the shared schedule model symmetric: each document points to the other team's game as its counterpart.

Risk surface:
- Limited to linked schedule mirroring metadata.
- Main regression risk is flipping the wrong side's metadata, so unit coverage is required.
