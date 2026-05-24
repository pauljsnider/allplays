# Architecture

- updateEvent ultimately uses Firestore updateDoc, so omitted keys are not removed from existing documents.
- The payload helper must encode deletion intent with deleteField() sentinels at the boundary where practiceData is prepared.
- Keep the helper as the single recurrence payload policy point to limit blast radius.
- Rollback is reverting this helper/test change.
